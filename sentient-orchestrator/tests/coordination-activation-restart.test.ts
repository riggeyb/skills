import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { CoordinationActivationClaimStore } from "../src/coordination-activation-claim-store.js";
import { CoordinationActivationSupervisor } from "../src/coordination-activation-supervisor.js";
import { CoordinationActivationWatchdog } from "../src/coordination-activation-watchdog.js";
import {
  ModelExecutionAdapterRegistry,
  type ModelExecutionAdapter,
  type ModelExecutionResponse,
} from "../src/model-execution.js";
import { ModelBackedWorkerRuntime } from "../src/model-backed-worker-runtime.js";
import { SentientCoordinationService } from "../src/sentient-coordination.js";
import { RuntimeRegistry, type RuntimeRequirements, type SentientWorker } from "../src/worker-control.js";
import { WorkerStore } from "../src/worker-store.js";

const url = process.env.DATABASE_URL;
const repository = { owner: "riggeyb", repo: "skills" };

test("a durably bound starting activation resumes after supervisor/runtime restart without duplicate execution", { skip: !url }, async () => {
  const db = new Pool({ connectionString: url! });
  let taskId: string | undefined;
  try {
    taskId = await createTask(db);
    const recipient = await createWorker(db, taskId, "restart-recipient");
    const sender = await createWorker(db, taskId, "restart-sender");
    const coordination = new SentientCoordinationService(db);
    const incoming = await coordination.send(actor(sender), {
      target: { kind: "worker", workerId: recipient.id },
      type: "QUESTION",
      correlationId: "activation:restart",
      payload: { question: "Resume this durable wake after restart." },
    });

    const watchdog = new CoordinationActivationWatchdog(db);
    assert.equal(await watchdog.tick(), 1);

    const claims = new CoordinationActivationClaimStore(db);
    const claimed = await claims.claim("pre-crash-supervisor", 5_000);
    assert.ok(claimed);
    assert.equal(claimed.message_id, incoming.messageId);
    assert.equal(Number(claimed.activation_attempts), 1);

    let adapterCalls = 0;
    const adapter: ModelExecutionAdapter = {
      id: "activation-restart-adapter",
      providerId: "test-provider",
      compatible: (requirements) => requirements.capabilities.includes("coord-activation-test"),
      async execute(request): Promise<ModelExecutionResponse> {
        adapterCalls++;
        assert.equal(request.coordinationActivation?.activationId, claimed.activation_id);
        assert.equal(request.coordinationActivation?.activationAttempt, 1);
        assert.equal(request.coordinationActivation?.triggerMessageId, incoming.messageId);
        return {
          status: "completed",
          conclusion: "resumed after durable bind",
          evidence: [],
          artifacts: [],
          toolResults: [],
          coordinationActions: [{ kind: "ack", messageId: incoming.messageId }],
          usage: { costUsd: 0.02 },
        };
      },
    };
    const registry = new ModelExecutionAdapterRegistry([adapter]);
    const beforeRestart = new ModelBackedWorkerRuntime(db, registry, coordination);
    const requirements: RuntimeRequirements = {
      capabilities: ["coord-activation-test"],
      maxCostUsd: 1,
    };
    const prepared = await beforeRestart.activate!(recipient, requirements, {
      activationId: claimed.activation_id,
      triggerMessageId: incoming.messageId,
      activationAttempt: 1,
    });

    const bound = await claims.bindRunning(
      claimed.activation_id,
      recipient.id,
      prepared.handle,
      "pre-crash-supervisor",
      5_000,
    );
    assert.equal(bound, true);

    const preparedState = await beforeRestart.inspect(prepared.handle);
    assert.equal(preparedState.status, "starting");
    assert.equal(adapterCalls, 0);

    // Simulate process loss after durable activation ownership was committed but before provider execution started.
    const afterRestart = new ModelBackedWorkerRuntime(db, registry, coordination);
    const supervisor = new CoordinationActivationSupervisor(
      db,
      new WorkerStore(db),
      new RuntimeRegistry([afterRestart]),
      "post-crash-supervisor",
      { leaseMs: 5_000, batchSize: 8, retryBackoffMs: 0 },
    );

    await supervisor.tick();
    await waitForExecutionTerminal(db, claimed.activation_id, 1);
    await supervisor.tick();

    const activation = await db.query(
      `SELECT state,activation_attempts FROM sentient_coordination_activations WHERE activation_id=$1`,
      [claimed.activation_id],
    );
    assert.equal(activation.rows[0].state, "completed");
    assert.equal(Number(activation.rows[0].activation_attempts), 1);

    const delivery = await db.query(
      `SELECT state,delivery_attempts FROM sentient_coordination_deliveries
       WHERE message_id=$1 AND recipient_worker_id=$2`,
      [incoming.messageId, recipient.id],
    );
    assert.equal(delivery.rows[0].state, "acknowledged");
    assert.equal(Number(delivery.rows[0].delivery_attempts), 1);

    const worker = await db.query(
      `SELECT status,runtime_handle,spent_usd FROM sentient_workers WHERE id=$1`,
      [recipient.id],
    );
    assert.equal(worker.rows[0].status, "waiting");
    assert.equal(worker.rows[0].runtime_handle, null);
    assert.equal(Number(worker.rows[0].spent_usd), 0.02);

    const executions = await db.query(
      `SELECT count(*)::int AS n,min(execution_attempt)::int AS attempt
       FROM worker_coordination_runtime_executions WHERE activation_id=$1`,
      [claimed.activation_id],
    );
    assert.equal(Number(executions.rows[0].n), 1);
    assert.equal(Number(executions.rows[0].attempt), 1);
    assert.equal(adapterCalls, 1);
  } finally {
    if (taskId) await db.query(`DELETE FROM tasks WHERE id=$1`, [taskId]);
    await db.end();
  }
});

async function createTask(db: Pool): Promise<string> {
  const deliveryId = randomUUID();
  const result = await db.query(
    `INSERT INTO tasks(delivery_id,objective,status,origin)
     VALUES($1,'coordination activation restart test','running',$2::jsonb)
     RETURNING id`,
    [deliveryId, JSON.stringify({
      repository,
      installationId: 1,
      deliveryId,
      requestedBy: "coordination-activation-restart-test",
    })],
  );
  return result.rows[0].id;
}

async function createWorker(db: Pool, taskId: string, role: string): Promise<SentientWorker> {
  const tenant = `coord-activation-restart:${taskId}`;
  const correlationId = `coord-activation-restart:${randomUUID()}`;
  const assignment = { objective: `${role} coordination`, assignmentId: `phase:${role}` };
  const spawn = await db.query(
    `INSERT INTO worker_spawn_requests(
       task_id,tenant,repository_owner,repository_name,role,subtask,required_capabilities,
       max_cost_usd,idempotency_key,correlation_id,status
     )
     VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,1,$8,$9,'scheduled')
     RETURNING id`,
    [
      taskId, tenant, repository.owner, repository.repo, role, JSON.stringify(assignment),
      ["coord-activation-test"], randomUUID(), correlationId,
    ],
  );
  const spawnRequestId = spawn.rows[0].id;
  const row = await db.query(
    `INSERT INTO sentient_workers(
       spawn_request_id,task_id,tenant,repository_owner,repository_name,role,assignment,status,
       runtime_id,capabilities,authority,budget_usd,attempt_count,correlation_id
     )
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,'waiting','model-backed',$8,'{}'::jsonb,1,1,$9)
     RETURNING id`,
    [
      spawnRequestId, taskId, tenant, repository.owner, repository.repo, role, JSON.stringify(assignment),
      ["coord-activation-test"], correlationId,
    ],
  );
  return {
    id: row.rows[0].id,
    spawnRequestId,
    taskId,
    tenant,
    repository,
    role,
    assignment,
    status: "waiting",
    runtimeId: "model-backed",
    attemptCount: 1,
    budgetUsd: 1,
    spentUsd: 0,
    correlationId,
    capabilities: ["coord-activation-test"],
    authority: {},
    modelProviderRequirements: {},
  };
}

function actor(worker: SentientWorker) {
  return {
    workerId: worker.id,
    taskId: worker.taskId,
    tenant: worker.tenant,
    repository: worker.repository!,
    attemptCount: worker.attemptCount,
  };
}

async function waitForExecutionTerminal(db: Pool, activationId: string, attempt: number): Promise<void> {
  for (let index = 0; index < 200; index++) {
    const result = await db.query(
      `SELECT status FROM worker_coordination_runtime_executions
       WHERE activation_id=$1 AND execution_attempt=$2`,
      [activationId, attempt],
    );
    if (result.rows[0] && ["completed", "failed", "cancelled"].includes(result.rows[0].status)) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`coordination activation ${activationId} did not reach terminal state`);
}
