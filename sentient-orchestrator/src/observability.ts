import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { SecretRedactor } from "./redaction.js";

export type LogLevel = "debug" | "info" | "warn" | "error" | "critical";
export type ServiceStatus = "starting" | "ready" | "degraded" | "stopping";

export interface LogContext {
  service: string;
  event: string;
  correlationId?: string;
  installationId?: number;
  repository?: { owner: string; repo: string };
  taskId?: string;
  details?: Record<string, unknown>;
  error?: unknown;
}

export class StructuredLogger {
  constructor(
    private readonly redactor = new SecretRedactor(),
    private readonly write: (line: string) => void = (line) => console.log(line),
  ) {}

  log(level: LogLevel, context: LogContext): void {
    validateEventName(context.event);
    const payload = this.redactor.redactValue({
      timestamp: new Date().toISOString(),
      level,
      service: context.service,
      event: context.event,
      correlationId: context.correlationId,
      installationId: context.installationId,
      repository: context.repository,
      taskId: context.taskId,
      details: context.details,
      error: serializeError(context.error),
    });
    this.write(JSON.stringify(payload));
  }

  debug(context: LogContext): void { this.log("debug", context); }
  info(context: LogContext): void { this.log("info", context); }
  warn(context: LogContext): void { this.log("warn", context); }
  error(context: LogContext): void { this.log("error", context); }
  critical(context: LogContext): void { this.log("critical", context); }
}

type Labels = Record<string, string | number | boolean | undefined>;

export class MetricRegistry {
  private readonly values = new Map<string, { name: string; labels: Record<string, string>; value: number; help?: string }>();

  inc(name: string, labels: Labels = {}, amount = 1, help?: string): void {
    if (!Number.isFinite(amount)) throw new Error("Metric increment must be finite");
    const entry = this.entry(name, labels, help);
    entry.value += amount;
  }

  set(name: string, value: number, labels: Labels = {}, help?: string): void {
    if (!Number.isFinite(value)) throw new Error("Metric value must be finite");
    this.entry(name, labels, help).value = value;
  }

  renderPrometheus(): string {
    const lines: string[] = [];
    const emittedHelp = new Set<string>();
    for (const entry of [...this.values.values()].sort((a, b) => metricKey(a.name, a.labels).localeCompare(metricKey(b.name, b.labels)))) {
      if (entry.help && !emittedHelp.has(entry.name)) {
        lines.push(`# HELP ${entry.name} ${entry.help.replace(/\n/g, " ")}`);
        emittedHelp.add(entry.name);
      }
      lines.push(`${entry.name}${formatLabels(entry.labels)} ${entry.value}`);
    }
    return `${lines.join("\n")}\n`;
  }

  private entry(name: string, labels: Labels, help?: string) {
    validateMetricName(name);
    const normalized = Object.fromEntries(
      Object.entries(labels)
        .filter(([, value]) => value !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, String(value)]),
    );
    const key = metricKey(name, normalized);
    let entry = this.values.get(key);
    if (!entry) {
      entry = { name, labels: normalized, value: 0, help };
      this.values.set(key, entry);
    } else if (help && !entry.help) {
      entry.help = help;
    }
    return entry;
  }
}

export class PostgresReadinessProbe {
  constructor(private readonly pool: Pool) {}

  async check(): Promise<{
    ok: boolean;
    databaseMs: number;
    queuedJobs: number;
    oldestJobAgeSeconds: number;
    progressBacklog: number;
  }> {
    const started = Date.now();
    const [database, jobs, progress] = await Promise.all([
      this.pool.query("SELECT 1"),
      this.pool.query(
        `SELECT count(*)::integer AS queued,
                coalesce(extract(epoch FROM (now() - min(created_at))), 0)::double precision AS oldest_age
         FROM jobs
         WHERE status IN ('queued', 'leased')`,
      ),
      this.pool.query(
        `SELECT count(*)::integer AS backlog
         FROM progress_outbox
         WHERE status IN ('queued', 'leased')`,
      ),
    ]);
    const databaseMs = Date.now() - started;
    return {
      ok: database.rowCount === 1,
      databaseMs,
      queuedJobs: Number(jobs.rows[0]?.queued ?? 0),
      oldestJobAgeSeconds: Number(jobs.rows[0]?.oldest_age ?? 0),
      progressBacklog: Number(progress.rows[0]?.backlog ?? 0),
    };
  }
}

export class PostgresServiceHeartbeat {
  constructor(
    private readonly pool: Pool,
    private readonly service: string,
    private readonly instanceId: string,
    private readonly revision = process.env.RENDER_GIT_COMMIT || process.env.GIT_SHA || undefined,
  ) {
    if (!service.trim() || !instanceId.trim()) throw new Error("service and instanceId are required");
  }

  async beat(status: ServiceStatus, details: Record<string, unknown> = {}): Promise<void> {
    await this.pool.query(
      `INSERT INTO service_heartbeats(service, instance_id, revision, status, details)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (service, instance_id) DO UPDATE
       SET revision = EXCLUDED.revision,
           status = EXCLUDED.status,
           details = EXCLUDED.details,
           last_seen_at = now()`,
      [this.service, this.instanceId, this.revision ?? null, status, JSON.stringify(details)],
    );
  }
}

export class PostgresOperationalEvents {
  constructor(private readonly pool: Pool, private readonly redactor = new SecretRedactor()) {}

  async record(input: {
    eventKey?: string;
    severity: LogLevel;
    service: string;
    eventName: string;
    installationId?: number;
    repository?: { owner: string; repo: string };
    taskId?: string;
    correlationId?: string;
    details?: Record<string, unknown>;
  }): Promise<void> {
    validateEventName(input.eventName);
    const safeDetails = this.redactor.redactValue(input.details ?? {});
    const eventKey =
      input.eventKey ??
      createHash("sha256")
        .update(JSON.stringify({
          service: input.service,
          eventName: input.eventName,
          taskId: input.taskId ?? null,
          correlationId: input.correlationId ?? null,
          details: safeDetails,
        }))
        .digest("hex");

    await this.pool.query(
      `INSERT INTO operational_events(
         event_key, severity, service, event_name, installation_id,
         repository_owner, repository_name, task_id, correlation_id, details
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
       ON CONFLICT (event_key) DO NOTHING`,
      [
        eventKey,
        input.severity,
        input.service,
        input.eventName,
        input.installationId ?? null,
        input.repository?.owner ?? null,
        input.repository?.repo ?? null,
        input.taskId ?? null,
        input.correlationId ?? null,
        JSON.stringify(safeDetails),
      ],
    );
  }
}

export function startHeartbeatLoop(input: {
  heartbeat: PostgresServiceHeartbeat;
  status?: ServiceStatus;
  intervalMs?: number;
  details?: () => Record<string, unknown>;
  signal?: AbortSignal;
}): { stop(): Promise<void> } {
  const intervalMs = input.intervalMs ?? 15_000;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000) throw new Error("heartbeat interval must be >= 1000ms");
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const run = async () => {
    if (stopped || input.signal?.aborted) return;
    try {
      await input.heartbeat.beat(input.status ?? "ready", input.details?.() ?? {});
    } finally {
      if (!stopped && !input.signal?.aborted) timer = setTimeout(() => void run(), intervalMs);
    }
  };
  void run();

  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await input.heartbeat.beat("stopping");
    },
  };
}

function validateEventName(value: string): void {
  if (!/^[a-z][a-z0-9_.-]{1,127}$/.test(value)) throw new Error(`Invalid event name ${JSON.stringify(value)}`);
}

function validateMetricName(value: string): void {
  if (!/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(value)) throw new Error(`Invalid metric name ${JSON.stringify(value)}`);
}

function metricKey(name: string, labels: Record<string, string>): string {
  return `${name}|${Object.entries(labels).map(([key, value]) => `${key}=${value}`).join("|")}`;
}

function formatLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return "";
  return `{${entries.map(([key, value]) => `${key}="${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`).join(",")}}`;
}

function serializeError(error: unknown): unknown {
  if (!error) return undefined;
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  return String(error);
}
