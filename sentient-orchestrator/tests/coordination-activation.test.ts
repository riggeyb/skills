import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { CoordinationActivationSupervisor } from "../src/coordination-activation-supervisor.js";
import {
  ModelExecutionAdapterRegistry,
  type ModelExecutionAdapter,
  type ModelExecutionResponse,
} from "../src/model-execution.js";
import { ModelBackedWorkerRuntime } from "../src/model-backed-worker-runtime.js";
import { SentientCoordinationService } from "../src/sentient-coordination.js";
import { DIRECT_COORDINATION_RULE } from "../src/sentient-coordination-types.js";
import { RuntimeRegistry, type SentientWorker } from "../src/worker-control.js";
import { WorkerStore } from "../src/worker-store.js";

const url = process.env.DATABASE_URL;
const repository = { owner: "riggeyb", repo: "skills" };

test("coordination message automatically wakes the same idle Sentient, acknowledges it, and returns to waiting", { skip: !url }, async () => {
  const db = new Pool({ connectionString: url! });
  let taskId: string | undefined;
  try {
    taskId = await createTask(db);
    const recipient = await createWorker(db, taskId, "recipient");
    const sender = await createWorker(db, taskId, "sender");
    const coordination = new SentientCoordinationService(db);
    const incoming = await coordination.send(actor(sender), {
      target: { kind: "worker", workerId: recipient.id },
      type: "QUESTION",
      correlationId: "activation:success",
      payload: { question: "Can you answer directly?" },
    });
    const beforeCount = Number((await db.query(
      `SELECT count(*)::int AS n FROM sentient_workers WHERE task_id=$1`,
      [taskId],
    )).rows[0].n);

    let adapterCalls = 0;
    const adapter: ModelExecutionAdapter = {
      id: "activation-success-adapter",
      providerId: "test-provider",
      compatible: (requirements) => requirements.capabilities.includes("coord-activation-test"),
      async execute(request): Promise<ModelExecutionResponse> {
        adapterCalls++;
        assert.equal(request.coordinationActivation?.triggerMessageId, incoming.messageId);
        assert.equal(request.coordinationActivation?.activationAttempt, 1);
        assert.equal(request.coordination?.behavioralRule, DIRECT_COORDINATION_RULE);
        assert.equal(request.coordination?.pending[0]?.message.messageId, incoming.messageId);
        return {
          status: "completed",
          conclusion: "answered directly",
          evidence: [],
          artifacts: [],
          toolResults: [],
          coordinationActions: [
            { kind: "ack", messageId: incoming.messageId },
            {
              kind: "send",
              draft: {
                target: { kind: "worker", workerId: sender.id },
                type: "ANSWER",
                correlationId: incoming.correlationId,
                causationId: incoming.messageId,
                payload: { answer: "yes" },
              },
            },
          ],
          usage: { costUsd: 0.01 },
        };
      },
    };
    const runtime = new ModelBackedWorkerRuntime(
      db,
      new ModelExecutionAdapterRegistry([adapter]),
      coordination,
    );
    const supervisor = new CoordinationActivationSupervisor(
      db,
      new WorkerStore(db),
      new RuntimeRegistry([runtime]),
      "activation-success-supervisor",
      { leaseMs: 5_000, batchSize: 8, retryBackoffMs: 0 },
    );

    await supervisor.tick();
    await waitForExecutionTerminal(db, incoming.messageId, recipient.id, 1);
    await supervisor.tick();

    const worker = await db.query(
      `SELECT id,status,runtime_handle,spent_usd FROM sentient_workers WHERE id=$1`,
      [recipient.id],
    );
    assert.equal(worker.rows[0].id, recipient.id);
    assert.equal(worker.rows[0].status, "waiting");
    assert.equal(worker.rows[0].runtime_handle, null);
    assert.equal(Number(worker.rows[0].spent_usd), 0.01);

    const delivery = await db.query(
      `SELECT state,delivery_attempts FROM sentient_coordination_deliveries
       WHERE message_id=$1 AND recipient_worker_id=$2`,
      [incoming.messageId, recipient.id],
    );
    assert.equal(delivery.rows[0].state, "acknowledged");
    assert.equal(Number(delivery.rows[0].delivery_attempts), 1);

    const activation = await db.query(
      `SELECT state,activation_attempts FROM sentient_coordination_activations
       WHERE message_id=$1 AND recipient_worker_id=$2`,
      [incoming.messageId, recipient.id],
    );
    assert.equal(activation.rows[0].state, "completed");
    assert.equal(Number(activation.rows[0].activation_attempts), 1);

    const answer = await db.query(
      `SELECT sender_worker_id,recipient_worker_id,correlation_id,causation_id
       FROM sentient_coordination_messages
       WHERE sender_worker_id=$1 AND message_type='ANSWER'`,
      [recipient.id],
    );
    assert.equal(answer.rowCount, 1);
    assert.equal(answer.rows[0].recipient_worker_id, sender.id);
    assert.equal(answer.rows[0].correlation_id, incoming.correlationId);
    assert.equal(answer.rows[0].causation_id, incoming.messageId);

    await supervisor.tick();
    await supervisor.tick();
    const afterCount = Number((await db.query(
      `SELECT count(*)::int AS n FROM sentient_workers WHERE task_id=$1`,
      [taskId],
    )).rows[0].n);
    const executions = await db.query(
      `SELECT count(*)::int AS n FROM worker_coordination_runtime_executions
       WHERE worker_id=$1`,
      [recipient.id],
    );
    assert.equal(afterCount, beforeCount);
    assert.equal(Number(executions.rows[0].n), 1);
    assert.equal(adapterCalls, 1);
  } finally {
    if (taskId) await db.query(`DELETE FROM tasks WHERE id=$1`, [taskId]);
    await db.end();
  }
});

test("unacknowledged coordination activation retries are bounded and dead-lettered", { skip: !url }, async () => {
  const db = new Pool({ connectionString: url! });
  let taskId: string | undefined;
  try {
    taskId = await createTask(db);
    const recipient = await createWorker(db, taskId, "retry-recipient");
    const sender = await createWorker(db, taskId, "retry-sender");
    const coordination = new SentientCoordinationService(db);
    const incoming = await coordination.send(actor(sender), {
      target: { kind: "worker", workerId: recipient.id },
      type: "DEPENDENCY",
      correlationId: "activation:retry",
      payload: { dependency: "needs acknowledgement" },
    });

    let adapterCalls = 0;
    const adapter: ModelExecutionAdapter = {
      id: "activation-retry-adapter",
      providerId: "test-provider",
      compatible: (requirements) => requirements.capabilities.includes("coord-activation-test"),
      async execute(): Promise<ModelExecutionResponse> {
        adapterCalls++;
        return {
          status: "completed",
          conclusion: "processed but intentionally did not acknowledge",
          evidence: [],
          artifacts: [],
          toolResults: [],
          usage: { costUsd: 0 },
        };
      },
    };
    const runtime = new ModelBackedWorkerRuntime(
      db,
      new ModelExecutionAdapterRegistry([adapter]),
      coordination,
    );
    const supervisor = new CoordinationActivationSupervisor(
      db,
      new WorkerStore(db),
      new RuntimeRegistry([runtime]),
      "activation-retry-supervisor",
      { leaseMs: 5_000, batchSize: 8, retryBackoffMs: 0 },
    );

    for (let attempt = 1; attempt <= 3; attempt++) {
      await supervisor.tick();
      await waitForExecutionTerminal(db, incoming.messageId, recipient.id, attempt);
      await supervisor.tick();

      if (attempt < 3) {
        const state = await activationState(db, incoming.messageId, recipient.id);
        assert.equal(state.state, "pending");
        assert.equal(Number(state.activation_attempts), attempt);
        await db.query(
          `UPDATE sentient_coordination_deliveries
           SET next_delivery_at=now()
           WHERE message_id=$1 AND recipient_worker_id=$2`,
          [incoming.messageId, recipient.id],
        );
        await db.query(
          `UPDATE sentient_coordination_activations
           SET next_attempt_at=now()
           WHERE message_id=$1 AND recipient_worker_id=$2`,
          [incoming.messageId, recipient.id],
        );
      }
    }

    const activation = await activationState(db, incoming.messageId, recipient.id);
    assert.equal(activation.state, "dead_letter");
    assert.equal(Number(activation.activation_attempts), 3);
    assert.match(String(activation.last_error), /coordination_ack_retry_exhausted/);

    const delivery = await db.query(
      `SELECT state,dead_letter_reason,dead_lettered_at,delivery_attempts
       FROM sentient_coordination_deliveries
       WHERE message_id=$1 AND recipient_worker_id=$2`,
      [incoming.messageId, recipient.id],
    );
    assert.equal(delivery.rows[0].state, "dead_letter");
    assert.match(String(delivery.rows[0].dead_letter_reason), /coordination_ack_retry_exhausted/);
    assert.ok(delivery.rows[0].dead_lettered_at);
    assert.equal(Number(delivery.rows[0].delivery_attempts), 3);
    assert.equal(adapterCalls, 3);

    const worker = await db.query(
      `SELECT id,status,runtime_handle FROM sentient_workers WHERE id=$1`,
      [recipient.id],
    );
    assert.equal(worker.rows[0].id, recipient.id);
    assert.equal(worker.rows[0].status, "waiting");
    assert.equal(worker.rows[0].runtime_handle, null);

    const systemMessages = await db.query(
      `SELECT body FROM task_messages
       WHERE task_id=$1 AND role='system' AND body ILIKE '%dead-letter%'`,
      [taskId],
    );
    assert.ok((systemMessages.rowCount ?? 0) >= 1);

    await supervisor.tick();
    const after = await db.query(
      `SELECT count(*)::int AS n FROM worker_coordination_runtime_executions
       WHERE worker_id=$1`,
      [recipient.id],
    );
    assert.equal(Number(after.rows[0].n), 3);
  } finally {
    if (taskId) await db.query(`DELETE FROM tasks WHERE id=$1`, [taskId]);
    await db.end();
  }
});

async function createTask(db: Pool): Promise<string> {
  const deliveryId = randomUUID();
  const result = await db.query(
    `INSERT INTO tasks(delivery_id,objective,status,origin)
     VALUES($1,'coordination activation test','running',$2::jsonb)
     RETURNING id`,
    [deliveryId, JSON.stringify({
      repository,
      installationId: 1,
      deliveryId,
      requestedBy: "coordination-activation-test",
    })],
  );
  return result.rows[0].id;
}

async function createWorker(db: Pool, taskId: string, role: string): Promise<SentientWorker> {
  const tenant = `coord-activation:${taskId}`;
  const correlationId = `coord-activation:${randomUUID()}`;
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

async function activationState(db: Pool, messageId: string, workerId: string) {
  const result = await db.query(
    `SELECT state,activation_attempts,last_error
     FROM sentient_coordination_activations
     WHERE message_id=$1 AND recipient_worker_id=$2`,
    [messageId, workerId],
   );
  assert.equal(result.rowCount, 1);
  return result.rows[0];
}

async function waitForExecutionTerminal(
  db: Pool,
  messageId: string,
  workerId: string,
  attempt: number,
): Promise<void> {
  for (let index = 0; index < 200; index++) {
    const result = await db.query(
      `SELECT e.status
       FROM worker_coordination_runtime_executions e
       JOIN sentient_coordination_activations a ON a.activation_id=e.activation_id
       WHERE a.message_id=$1 AND e.worker_id=$2 AND e.execution_attempt=$3`,
      [messageId, workerId, attempt],
    );
    if (result.rows[0] && ["completed", "failed", "cancelled"].includes(result.rows[0].status)) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`coordination execution attempt ${attempt} did not reach terminal state`);
}
