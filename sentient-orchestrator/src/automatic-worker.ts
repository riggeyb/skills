import { createDatabasePool } from "./db.js";
import { AutomaticLeadSupervisor } from "./automatic-lead-supervisor.js";
import { runControlPlaneLoop } from "./control-plane-loop.js";
import { LeadOrchestrationStore } from "./lead-orchestration.js";
import {
  HttpModelExecutionAdapter,
  ModelExecutionAdapterRegistry,
} from "./model-execution.js";
import { ModelBackedWorkerRuntime } from "./model-backed-worker-runtime.js";
import { SentientCoordinationService } from "./sentient-coordination.js";
import { PostgresTaskStore } from "./postgres.js";
import { RenewablePostgresJobQueue } from "./renewable-postgres-queue.js";
import { SupervisedDemoRuntime } from "./supervised-demo-runtime.js";
import { TaskBootstrapper } from "./task-bootstrapper.js";
import { RuntimeRegistry, type WorkerRuntime } from "./worker-control.js";
import { runWorkerLoop } from "./worker-loop.js";
import { WorkerRuntimeReconciler } from "./worker-runtime-reconciler.js";
import { WorkerScheduler, WorkerSupervisor } from "./worker-scheduler.js";
import { WorkerStore } from "./worker-store.js";

const pool = createDatabasePool();
const queue = new RenewablePostgresJobQueue(pool);
const tasks = new PostgresTaskStore(pool);
const bootstrapper = new TaskBootstrapper(tasks);

const workers = new WorkerStore(pool);
const modelEndpoint = process.env.MODEL_RUNTIME_ENDPOINT?.trim();
let workerCapabilities = ["demo-agent"];
const runtimeList: WorkerRuntime[] = [new SupervisedDemoRuntime(["lead-control"])];

if (modelEndpoint) {
  workerCapabilities = parseCsv(process.env.MODEL_RUNTIME_CAPABILITIES ?? "demo-agent")
    .filter((capability) => capability !== "lead-control");
  if (!workerCapabilities.length) {
    throw new Error("MODEL_RUNTIME_CAPABILITIES must include a non-lead worker capability");
  }
  const adapter = new HttpModelExecutionAdapter({
    id: process.env.MODEL_RUNTIME_ADAPTER_ID ?? "generic-http-model",
    providerId: process.env.MODEL_RUNTIME_PROVIDER_ID ?? "generic-http",
    modelId: process.env.MODEL_RUNTIME_MODEL_ID,
    endpoint: modelEndpoint,
    bearerToken: process.env.MODEL_RUNTIME_AUTH_TOKEN,
    capabilities: workerCapabilities,
    modelTiers: parseCsv(process.env.MODEL_RUNTIME_MODEL_TIERS),
  });
  runtimeList.push(
    new ModelBackedWorkerRuntime(pool, new ModelExecutionAdapterRegistry([adapter])),
  );
} else {
  runtimeList[0] = new SupervisedDemoRuntime();
}

const runtimes = new RuntimeRegistry(runtimeList);
const workerLeaseMs = Number(process.env.WORKER_LEASE_MS ?? 60_000);
const scheduler = new WorkerScheduler(
  pool,
  workers,
  runtimes,
  process.env.SCHEDULER_ID ?? `scheduler-${process.pid}`,
  {
    leaseMs: workerLeaseMs,
    maxTaskWorkers: Number(process.env.MAX_TASK_WORKERS ?? 8),
    maxTenantWorkers: Number(process.env.MAX_TENANT_WORKERS ?? 32),
    maxTaskBudgetUsd: Number(process.env.MAX_TASK_BUDGET_USD ?? Number.POSITIVE_INFINITY),
    maxTenantBudgetUsd: Number(process.env.MAX_TENANT_BUDGET_USD ?? Number.POSITIVE_INFINITY),
  },
);
const runtimeReconciler = new WorkerRuntimeReconciler(pool, workers, runtimes, { leaseMs: workerLeaseMs });
const workerSupervisor = new WorkerSupervisor(workers, runtimes, workerLeaseMs);
const leadSupervisor = new AutomaticLeadSupervisor(
  pool,
  workers,
  new LeadOrchestrationStore(pool),
  {
    leaseMs: Number(process.env.LEAD_LEASE_MS ?? 60_000),
    maxAttempts: Number(process.env.WORKER_MAX_ATTEMPTS ?? 3),
    workerCapabilities,
  },
);

const controller = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => controller.abort());
}

try {
  await Promise.all([
    runWorkerLoop(queue, bootstrapper, {
      leaseMs: Number(process.env.JOB_LEASE_MS ?? process.env.WORKER_LEASE_MS ?? 60_000),
      idlePollMs: Number(process.env.WORKER_POLL_MS ?? 500),
      workerId: process.env.WORKER_ID,
      signal: controller.signal,
    }),
    runControlPlaneLoop(scheduler, runtimeReconciler, leadSupervisor, workerSupervisor, {
      pollMs: Number(process.env.CONTROL_PLANE_POLL_MS ?? 250),
      signal: controller.signal,
    }),
  ]);
} finally {
  await pool.end();
}

function parseCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
