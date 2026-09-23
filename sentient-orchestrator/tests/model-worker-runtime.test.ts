import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { AutomaticLeadSupervisor } from "../src/automatic-lead-supervisor.js";
import { LeadOrchestrationStore } from "../src/lead-orchestration.js";
import {
  ModelExecutionAdapterRegistry,
  type ModelExecutionAdapter,
  type ModelExecutionRequest,
  type ModelExecutionResponse,
} from "../src/model-execution.js";
import { ModelBackedWorkerRuntime } from "../src/model-backed-worker-runtime.js";
import { PostgresTaskStore } from "../src/postgres.js";
import { SupervisedDemoRuntime } from "../src/supervised-demo-runtime.js";
import {
  RuntimeRegistry,
  type RuntimeRequirements,
  type WorkerRuntimeState,
} from "../src/worker-control.js";
import { WorkerRuntimeReconciler } from "../src/worker-runtime-reconciler.js";
import { WorkerScheduler } from "../src/worker-scheduler.js";
import { WorkerStore } from "../src/worker-store.js";

const url = process.env.DATABASE_URL;

class FakeAdapter implements ModelExecutionAdapter {
  readonly id = "fake-adapter";
  readonly providerId = "fake-provider";
  readonly modelId = "cheap-test-model";
  readonly requests: ModelExecutionRequest[] = [];

  constructor(
    private readonly capabilities: string[],
    private readonly responder: (request: ModelExecutionRequest, signal: AbortSignal) => Promise<ModelExecutionResponse>,
  ) {}

  compatible(requirements: RuntimeRequirements): boolean {
    return requirements.capabilities.every((capability) => this.capabilities.includes(capability));
  }

  async execute(
    request: ModelExecutionRequest,
    context: { signal: AbortSignal },
  ): Promise<ModelExecutionResponse> {
    this.requests.push(request);
    return this.responder(request, context.signal);
  }
}

function successResponse(costUsd = 0.25): ModelExecutionResponse {
  return {
    status: "completed",
    conclusion: "assignment completed",
    evidence: [{ kind: "test", value: "provider-neutral execution" }],
    artifacts: [{ kind: "commit", value: "abc123" }],
    toolResults: [{ capability: "model-test", status: "ok" }],
    handoff: {
      completedWork: ["implemented assigned work"],
      findings: ["provider-neutral model execution completed"],
      testsResults: ["model worker integration test passed"],
      recommendedNextAction: "lead review",
    },
    usage: { costUsd, inputTokens: 10, outputTokens: 20 },
  };
}

async function createTask(db: Pool, objective = "exercise model worker runtime"): Promise<string> {
  const delivery = randomUUID();
  const result = await db.query(
    `INSERT INTO tasks(delivery_id,objective,status,origin)
     VALUES($1,$2,'queued',$3)
     RETURNING id`,
    [
      delivery,
      objective,
      {
        repository: { owner: "riggeyb", repo: "skills" },
        issueNumber: 66,
        installationId: 1,
        deliveryId: delivery,
        requestedBy: "model-worker-runtime-test",
      },
    ],
  );
  return result.rows[0].id as string;
}

async function scheduleModelWorker(
  db: Pool,
  adapter: ModelExecutionAdapter,
  options: {
    budgetUsd?: number;
    authority?: Record<string, unknown>;
    workspace?: unknown;
    coordinatorId?: string;
    correlationId?: string;
  } = {},
) {
  const taskId = await createTask(db);
  const store = new WorkerStore(db);
  const assignment = { objective: "make bounded change", scope: ["sentient-orchestrator"] };
  const coordinatorId = options.coordinatorId ?? `lead:${randomUUID()}`;
  const correlationId = options.correlationId ?? `corr:${randomUUID()}`;
  const request = await store.request({
    taskId,
    tenant: "tenant:model-runtime",
    repository: { owner: "riggeyb", repo: "skills" },
    role: "backend",
    assignment,
    requiredCapabilities: ["model-test"],
    maxCostUsd: options.budgetUsd ?? 1,
    repositoryPermissions: options.authority ?? { contents: "write" },
    workspaceRequirement: options.workspace ?? { branch: "sentient/test-model-worker" },
    coordinatorId,
    correlationId,
    idempotencyKey: `model-runtime:${taskId}`,
    maxAttempts: 2,
  });
  const runtime = new ModelBackedWorkerRuntime(
    db,
    new ModelExecutionAdapterRegistry([adapter]),
  );
  const runtimes = new RuntimeRegistry([runtime]);
  const scheduler = new WorkerScheduler(db, store, runtimes, `model-runtime-test:${randomUUID()}`, {
    leaseMs: 60_000,
  });
  const worker = await scheduler.tick();
  assert.ok(worker);
  assert.equal(worker.runtimeId, "model-backed");
  assert.ok(worker.runtimeHandle);
  assert.equal(worker.spawnRequestId, request.id);
  return {
    taskId,
    store,
    assignment,
    coordinatorId,
    correlationId,
    runtime,
    runtimes,
    worker,
  };
}

async function terminal(runtime: ModelBackedWorkerRuntime, handle: string): Promise<WorkerRuntimeState> {
  for (let i = 0; i < 100; i++) {
    const state = await runtime.inspect(handle);
    if (["completed", "failed", "cancelled"].includes(state.status)) return state;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("model runtime did not reach terminal state");
}

test("model-backed runtime preserves durable Sentient identity and returns a structured durable result", { skip: !url }, async () => {
  const db = new Pool({ connectionString: url! });
  try {
    const authority = { contents: "write", pullRequests: "read" };
    const workspace = { branch: "sentient/test-model-worker" };
    const coordinatorId = `lead:${randomUUID()}`;
    const correlationId = `corr:${randomUUID()}`;
    const adapter = new FakeAdapter(["model-test"], async () => successResponse(0.42));
    const scheduled = await scheduleModelWorker(db, adapter, {
      budgetUsd: 1,
      authority,
      workspace,
      coordinatorId,
      correlationId,
    });

    const state = await terminal(scheduled.runtime, scheduled.worker.runtimeHandle!);
    assert.equal(state.status, "completed");
    assert.equal(state.spentUsd, 0.42);
    assert.equal(state.result?.conclusion, "assignment completed");
    assert.equal(
      state.result?.handoff.handoffId,
      `worker:${scheduled.worker.id}:attempt:${scheduled.worker.attemptCount}`,
    );

    const captured = adapter.requests[0];
    assert.ok(captured);
    assert.equal(captured.identity.workerId, scheduled.worker.id);
    assert.equal(captured.identity.taskId, scheduled.taskId);
    assert.equal(captured.identity.tenant, "tenant:model-runtime");
    assert.deepEqual(captured.identity.repository, { owner: "riggeyb", repo: "skills" });
    assert.equal(captured.identity.coordinatorId, coordinatorId);
    assert.equal(captured.identity.correlationId, correlationId);
    assert.deepEqual(captured.boundaries.authority, authority);
    assert.deepEqual(captured.boundaries.workspace, workspace);
    assert.equal(captured.boundaries.budgetUsd, 1);
    assert.equal(captured.responseContract.privateReasoningForbidden, true);

    const reconciler = new WorkerRuntimeReconciler(db, scheduled.store, scheduled.runtimes);
    assert.equal(await reconciler.tick(), 1);
    const durableWorker = await scheduled.store.get(scheduled.worker.id);
    assert.equal(durableWorker.status, "completed");
    assert.equal(durableWorker.spentUsd, 0.42);

    const execution = await db.query(
      `SELECT provider_id,model_id,result,spent_usd
       FROM worker_runtime_executions
       WHERE worker_id=$1`,
      [scheduled.worker.id],
    );
    assert.equal(execution.rows[0].provider_id, "fake-provider");
    assert.equal(execution.rows[0].model_id, "cheap-test-model");
    assert.equal(Number(execution.rows[0].spent_usd), 0.42);
    assert.deepEqual(execution.rows[0].result.handoff.findings, [
      "provider-neutral model execution completed",
    ]);

    await assert.rejects(
      scheduled.runtime.assign(scheduled.worker.runtimeHandle!, { objective: "tampered assignment" }),
      /assignment_boundary_violation/,
    );
  } finally {
    await db.end();
  }
});

test("model-backed runtime fails closed on private reasoning, tool escape, overspend, and restart ambiguity", { skip: !url }, async () => {
  const db = new Pool({ connectionString: url! });
  try {
    const privateReasoning = new FakeAdapter(["model-test"], async () => ({
      ...successResponse(),
      evidence: [{ reasoning: "private chain-of-thought must never cross the boundary" }],
    }));
    const privateRun = await scheduleModelWorker(db, privateReasoning);
    const privateState = await terminal(privateRun.runtime, privateRun.worker.runtimeHandle!);
    assert.equal(privateState.status, "failed");
    assert.match(privateState.reason ?? "", /private_reasoning_field/);

    const toolEscape = new FakeAdapter(["model-test"], async () => ({
      ...successResponse(),
      toolResults: [{ capability: "admin-shell", status: "ok" }],
    }));
    const toolRun = await scheduleModelWorker(db, toolEscape);
    const toolState = await terminal(toolRun.runtime, toolRun.worker.runtimeHandle!);
    assert.equal(toolState.status, "failed");
    assert.match(toolState.reason ?? "", /tool_capability_boundary_violation:admin-shell/);

    const overspend = new FakeAdapter(["model-test"], async () => successResponse(2));
    const overspendRun = await scheduleModelWorker(db, overspend, { budgetUsd: 1 });
    const overspendState = await terminal(overspendRun.runtime, overspendRun.worker.runtimeHandle!);
    assert.equal(overspendState.status, "failed");
    assert.equal(overspendState.reason, "budget_exceeded_by_provider");
    assert.equal(overspendState.spentUsd, 2);

    let release!: () => void;
    const hanging = new FakeAdapter(
      ["model-test"],
      async () => new Promise<ModelExecutionResponse>((resolve) => {
        release = () => resolve(successResponse());
      }),
    );
    const restartRun = await scheduleModelWorker(db, hanging);
    const restarted = new ModelBackedWorkerRuntime(
      db,
      new ModelExecutionAdapterRegistry([hanging]),
    );
    const restartState = await restarted.inspect(restartRun.worker.runtimeHandle!);
    assert.equal(restartState.status, "failed");
    assert.equal(restartState.reason, "runtime_restart_unknown_outcome");
    release();
  } finally {
    await db.end();
  }
});

test("automatic Lead supervision routes specialist assignments through model runtime and accepts their durable handoffs", { skip: !url }, async () => {
  const db = new Pool({ connectionString: url! });
  try {
    const tasks = new PostgresTaskStore(db);
    const task = await tasks.create(
      "prove automatic model-backed Sentient workers",
      {
        repository: { owner: "riggeyb", repo: "skills" },
        issueNumber: 66,
        installationId: 77,
        deliveryId: randomUUID(),
        requestedBy: "automatic-model-worker-test",
      },
      [],
    );
    const workers = new WorkerStore(db);
    const adapter = new FakeAdapter(["model-test"], async () => successResponse(0.05));
    const modelRuntime = new ModelBackedWorkerRuntime(
      db,
      new ModelExecutionAdapterRegistry([adapter]),
    );
    const runtimes = new RuntimeRegistry([
      new SupervisedDemoRuntime(["lead-control"]),
      modelRuntime,
    ]);
    const scheduler = new WorkerScheduler(db, workers, runtimes, `auto-model:${randomUUID()}`, {
      leaseMs: 60_000,
    });
    const reconciler = new WorkerRuntimeReconciler(db, workers, runtimes);
    const lead = new AutomaticLeadSupervisor(
      db,
      workers,
      new LeadOrchestrationStore(db),
      {
        leaseMs: 60_000,
        maxAttempts: 2,
        leadCapabilities: ["lead-control"],
        workerCapabilities: ["model-test"],
      },
    );

    for (let i = 0; i < 100; i++) {
      await lead.tick();
      await scheduler.tick();
      await reconciler.tick();
      await lead.tick();
      if ((await tasks.get(task.id)).status === "completed") break;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    assert.equal((await tasks.get(task.id)).status, "completed");
    const workerRows = await db.query(
      `SELECT role,runtime_id,status
       FROM sentient_workers
       WHERE task_id=$1
       ORDER BY role`,
      [task.id],
    );
    const specialists = workerRows.rows.filter((row) => row.role !== "lead");
    assert.equal(specialists.length, 5);
    assert.ok(specialists.every((row) => row.runtime_id === "model-backed" && row.status === "completed"));

    const assignments = await db.query(
      `SELECT external_id,status,handoff
       FROM worker_assignments
       WHERE task_id=$1
       ORDER BY external_id`,
      [task.id],
    );
    assert.equal(assignments.rowCount, 5);
    assert.ok(assignments.rows.every((row) => row.status === "accepted"));
    assert.ok(assignments.rows.every((row) =>
      row.handoff?.findings?.includes("provider-neutral model execution completed"),
    ));
    assert.ok(assignments.rows.every((row) =>
      row.handoff?.completedWork?.includes("implemented assigned work"),
    ));
  } finally {
    await db.end();
  }
});
