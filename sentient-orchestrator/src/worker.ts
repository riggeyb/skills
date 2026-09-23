import { createDemoAgents } from "./agents.js";
import { createDatabasePool } from "./db.js";
import { ModelRouter } from "./model-router.js";
import {
  PostgresServiceHeartbeat,
  StructuredLogger,
  startHeartbeatLoop,
} from "./observability.js";
import { Orchestrator } from "./orchestrator.js";
import { PostgresTaskStore } from "./postgres.js";
import {
  PostgresProgressOutbox,
  ProgressOutboxSink,
} from "./progress-outbox.js";
import { RenewablePostgresJobQueue } from "./renewable-postgres-queue.js";
import { runWorkerLoop } from "./worker-loop.js";

const pool = createDatabasePool();
const queue = new RenewablePostgresJobQueue(pool);
const store = new PostgresTaskStore(pool);
const progress = new ProgressOutboxSink(
  new PostgresProgressOutbox(pool),
  undefined,
  process.env.SENTIENT_DISCUSSION_ID || undefined,
);
const workerId = process.env.WORKER_ID || `worker-${process.pid}`;
const logger = new StructuredLogger();
const heartbeat = new PostgresServiceHeartbeat(pool, "worker", workerId);
const heartbeatLoop = startHeartbeatLoop({
  heartbeat,
  details: () => ({ workerId, pid: process.pid }),
});

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

logger.info({
  service: "worker",
  event: "service.started",
  details: { workerId, pid: process.pid },
});

try {
  await runWorkerLoop(queue, orchestrator, {
    leaseMs: Number(process.env.WORKER_LEASE_MS ?? 60_000),
    idlePollMs: Number(process.env.WORKER_POLL_MS ?? 500),
    workerId,
    signal: controller.signal,
  });
} catch (error) {
  logger.error({
    service: "worker",
    event: "worker.loop.failed",
    details: { workerId },
    error,
  });
  throw error;
} finally {
  await heartbeatLoop.stop();
  await pool.end();
}
