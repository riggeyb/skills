import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createDatabasePool } from "./db.js";
import { PostgresGitHubLifecycleStore } from "./github-lifecycle.js";
import {
  MetricRegistry,
  PostgresReadinessProbe,
  PostgresServiceHeartbeat,
  StructuredLogger,
  startHeartbeatLoop,
} from "./observability.js";
import { PostgresJobQueue } from "./postgres.js";
import { handleGitHubWebhook } from "./webhook.js";

const webhookSecret = required("GITHUB_WEBHOOK_SECRET");
const pool = createDatabasePool();
const queue = new PostgresJobQueue(pool);
const lifecycle = new PostgresGitHubLifecycleStore(pool);
const port = Number(process.env.PORT ?? 3000);
const metrics = new MetricRegistry();
const logger = new StructuredLogger();
const readiness = new PostgresReadinessProbe(pool);
const heartbeat = new PostgresServiceHeartbeat(
  pool,
  "api",
  process.env.API_INSTANCE_ID || process.env.HOSTNAME || `api-${process.pid}`,
);
const heartbeatLoop = startHeartbeatLoop({
  heartbeat,
  details: () => ({ port }),
});

const server = createServer(async (request, response) => {
  const started = Date.now();
  metrics.inc("sentient_http_requests_total", {
    method: request.method ?? "UNKNOWN",
    path: routeLabel(request.url),
  });

  try {
    if (request.method === "GET" && request.url === "/healthz") {
      return json(response, 200, { ok: true });
    }

    if (request.method === "GET" && request.url === "/readyz") {
      const state = await readiness.check();
      publishReadinessMetrics(state);
      return json(response, state.ok ? 200 : 503, state);
    }

    if (request.method === "GET" && request.url === "/metrics") {
      const state = await readiness.check();
      publishReadinessMetrics(state);
      return text(response, 200, metrics.renderPrometheus(), "text/plain; version=0.0.4; charset=utf-8");
    }

    if (request.method === "POST" && request.url === "/api/github/webhooks") {
      const deliveryId = header(request, "x-github-delivery");
      const eventName = header(request, "x-github-event");
      const rawBody = await readBody(request);
      const result = await handleGitHubWebhook({
        eventName,
        deliveryId,
        signature: header(request, "x-hub-signature-256"),
        rawBody,
        webhookSecret,
        queue,
        lifecycle,
      });
      metrics.inc("sentient_webhooks_total", {
        event: eventName || "unknown",
        accepted: result.accepted,
      });
      logger.info({
        service: "api",
        event: "github.webhook.received",
        correlationId: deliveryId || undefined,
        details: { eventName, accepted: result.accepted },
      });
      return json(response, result.accepted ? 202 : 200, result);
    }

    metrics.inc("sentient_http_responses_total", { status: 404 });
    json(response, 404, { error: "not_found" });
  } catch (error) {
    metrics.inc("sentient_http_responses_total", { status: 500 });
    logger.error({
      service: "api",
      event: "http.request.failed",
      correlationId: header(request, "x-github-delivery") || undefined,
      details: { method: request.method, path: routeLabel(request.url) },
      error,
    });
    json(response, 500, { error: "internal_error" });
  } finally {
    metrics.inc(
      "sentient_http_request_duration_ms_total",
      { method: request.method ?? "UNKNOWN", path: routeLabel(request.url) },
      Date.now() - started,
    );
  }
});

server.listen(port, () => {
  logger.info({
    service: "api",
    event: "service.started",
    details: { port, pid: process.pid },
  });
});

const shutdown = async (signal: string) => {
  logger.info({
    service: "api",
    event: "service.shutdown",
    details: { signal },
  });
  server.close(async () => {
    await heartbeatLoop.stop();
    await pool.end();
    process.exit(0);
  });
};

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

function publishReadinessMetrics(state: Awaited<ReturnType<PostgresReadinessProbe["check"]>>): void {
  metrics.set("sentient_database_ready", state.ok ? 1 : 0);
  metrics.set("sentient_database_probe_ms", state.databaseMs);
  metrics.set("sentient_jobs_queued", state.queuedJobs);
  metrics.set("sentient_jobs_oldest_age_seconds", state.oldestJobAgeSeconds);
  metrics.set("sentient_progress_outbox_backlog", state.progressBacklog);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function header(request: IncomingMessage, name: string): string {
  const value = request.headers[name];
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function text(response: ServerResponse, status: number, body: string, contentType: string): void {
  response.writeHead(status, { "Content-Type": contentType });
  response.end(body);
}

function routeLabel(url: string | undefined): string {
  if (!url) return "unknown";
  if (url.startsWith("/api/github/webhooks")) return "/api/github/webhooks";
  if (url === "/healthz" || url === "/readyz" || url === "/metrics") return url;
  return "other";
}
