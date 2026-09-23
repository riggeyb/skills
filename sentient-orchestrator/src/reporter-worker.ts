import { randomUUID } from "node:crypto";
import { PostgresTenantAuthorizer } from "./authorization.js";
import { createDatabasePool } from "./db.js";
import { GitHubAppTokenProvider } from "./github.js";
import {
  GitHubProgressDestination,
  runProgressReporterLoop,
} from "./progress-delivery.js";
import { PostgresProgressOutbox } from "./progress-outbox.js";

const appId = required("GITHUB_APP_ID");
const privateKey = required("GITHUB_PRIVATE_KEY").replace(/\\n/g, "\n");
const pool = createDatabasePool();
const outbox = new PostgresProgressOutbox(pool);
const authorization = new PostgresTenantAuthorizer(pool);
const destination = new GitHubProgressDestination(
  new GitHubAppTokenProvider(appId, privateKey),
  authorization,
);
const controller = new AbortController();

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => controller.abort());
}

try {
  await runProgressReporterLoop(outbox, destination, {
    workerId: process.env.REPORTER_WORKER_ID ?? `reporter-${randomUUID()}`,
    leaseMs: Number(process.env.REPORTER_LEASE_MS ?? 60_000),
    idlePollMs: Number(process.env.REPORTER_POLL_MS ?? 750),
    signal: controller.signal,
  });
} finally {
  await pool.end();
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}
