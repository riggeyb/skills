import { PostgresTenantAuthorizer } from "./authorization.js";
import { createDatabasePool } from "./db.js";
import { GitHubAppTokenProvider } from "./github.js";
import {
  GitHubProgressDestination,
  runProgressReporterLoop,
} from "./progress-delivery.js";
import { PostgresProgressOutbox } from "./progress-outbox.js";
import { SecretRedactor } from "./redaction.js";

const pool = createDatabasePool();
const redactor = new SecretRedactor();
const tokens = new GitHubAppTokenProvider(
  required("GITHUB_APP_ID"),
  privateKey(),
  process.env.GITHUB_API_BASE_URL || undefined,
);
const outbox = new PostgresProgressOutbox(pool);
const authorization = new PostgresTenantAuthorizer(pool);
const destination = new GitHubProgressDestination(tokens, authorization);
const controller = new AbortController();

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => controller.abort());
}

try {
  await runProgressReporterLoop(outbox, destination, {
    workerId: process.env.REPORTER_WORKER_ID || `reporter-${process.pid}`,
    leaseMs: numberEnv("REPORTER_LEASE_MS", 60_000),
    idlePollMs: numberEnv("REPORTER_POLL_MS", 750),
    signal: controller.signal,
    redactor,
  });
} finally {
  await pool.end();
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function privateKey(): string {
  return required("GITHUB_PRIVATE_KEY").replace(/\\n/g, "\n");
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}
