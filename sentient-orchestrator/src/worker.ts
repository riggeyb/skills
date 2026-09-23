import { createDemoAgents } from "./agents.js";
import { createDatabasePool } from "./db.js";
import {
  ConsoleProgressSink,
  GitHubAppTokenProvider,
  GitHubIssueProgressSink,
} from "./github.js";
import { ModelRouter } from "./model-router.js";
import { Orchestrator } from "./orchestrator.js";
import { PostgresTaskStore } from "./postgres.js";
import { RenewablePostgresJobQueue } from "./renewable-postgres-queue.js";
import { runWorkerLoop } from "./worker-loop.js";

const pool = createDatabasePool();
const queue = new RenewablePostgresJobQueue(pool);
const store = new PostgresTaskStore(pool);

const appId = process.env.GITHUB_APP_ID;
const privateKey = process.env.GITHUB_PRIVATE_KEY?.replace(/\\n/g, "\n");
const progress =
  appId && privateKey
    ? new GitHubIssueProgressSink(new GitHubAppTokenProvider(appId, privateKey))
    : new ConsoleProgressSink();

const orchestrator = new Orchestrator(
  store,
  createDemoAgents(),
  new ModelRouter(),
  progress,
);

const controller = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => controller.abort());
}

try {
  await runWorkerLoop(queue, orchestrator, {
    leaseMs: Number(process.env.WORKER_LEASE_MS ?? 60_000),
    idlePollMs: Number(process.env.WORKER_POLL_MS ?? 500),
    workerId: process.env.WORKER_ID,
    signal: controller.signal,
  });
} finally {
  await pool.end();
}
