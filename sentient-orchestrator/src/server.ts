import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createDatabasePool } from "./db.js";
import { PostgresJobQueue } from "./postgres.js";
import { handleGitHubWebhook } from "./webhook.js";

const webhookSecret = required("GITHUB_WEBHOOK_SECRET");
const pool = createDatabasePool();
const queue = new PostgresJobQueue(pool);
const port = Number(process.env.PORT ?? 3000);

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/healthz") {
      return json(response, 200, { ok: true });
    }

    if (request.method === "GET" && request.url === "/readyz") {
      await pool.query("SELECT 1");
      return json(response, 200, { ok: true });
    }

    if (request.method === "POST" && request.url === "/api/github/webhooks") {
      const rawBody = await readBody(request);
      const result = await handleGitHubWebhook({
        eventName: header(request, "x-github-event"),
        deliveryId: header(request, "x-github-delivery"),
        signature: header(request, "x-hub-signature-256"),
        rawBody,
        webhookSecret,
        queue,
      });
      return json(response, result.accepted ? 202 : 200, result);
    }

    json(response, 404, { error: "not_found" });
  } catch (error) {
    console.error(error);
    json(response, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, () => {
  console.log(`Sentient webhook API listening on :${port}`);
});

const shutdown = async (signal: string) => {
  console.log(`[sentient] ${signal} received; shutting down API`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
};

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

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
