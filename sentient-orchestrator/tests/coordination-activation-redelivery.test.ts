import assert from "node:assert/strict";
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
import { RuntimeRegistry } from "../src/worker-control.js";
import { WorkerStore } from "../src/worker-store.js";
import {
  activationState,
  actor,
  createTask,
  createWorker,
  deliveryState,
  executionCount,
  waitForExecutionTerminal,
  workerCount,
} from "./coordination-activation-acceptance-helpers.js";

const url = process.env.DATABASE_URL;

test("restart after completed unacked turn redelivers and the next attempt can ACK", { skip: !url }, async () => {
  const db = new Pool({ connectionString: url! });
  let taskId: string | undefined;
  try {
    taskId = await createTask(db);
    const recipient = await createWorker(db, taskId, "crash-recipient");
    const sender = await createWorker(db, taskId, "crash-sender");
    const coordination = new SentientCoordinationService(db);
    const incoming = await coordination.send(actor(sender), {
      target: { kind: "worker", workerId: recipient.id },
      type: "DEPENDENCY",
      correlationId: "activation:crash-before-ack",
      payload: { dependency: "redeliver after supervisor restart" },
    });

    let adapterCalls = 0;
    const adapter: ModelExecutionAdapter = {
      id: "activation-crash-redelivery-adapter",
      providerId: "test-provider",
      compatible: (requirements) => requirements.capabilities.includes("coord-activation-test"),
      async execute(request): Promise<ModelExecutionResponse> {
        adapterCalls++;
        assert.equal(request.coordinationActivation?.triggerMessageId, incoming.messageId);
        if (adapterCalls === 1) {
          return {
            status: "completed",
            conclusion: "first turn completed before acknowledgement",
            evidence: [],
            artifacts: [],
            toolResults: [],
            usage: { costUsd: 0 },
          };
        }
        return {
          status: "completed",
          conclusion: "redelivery acknowledged after restart",
          evidence: [],
          artifacts: [],
          toolResults: [],
          coordinationActions: [{ kind: "ack", messageId: incoming.messageId }],
          usage: { costUsd: 0 },
        };
      },
    };
    const registry = new ModelExecutionAdapterRegistry([adapter]);
    const runtimeBeforeCrash = new ModelBackedWorkerRuntime(db, registry, coordination);
    const supervisorBeforeCrash = new CoordinationActivationSupervisor(
      db,
      new WorkerStore(db),
      new RuntimeRegistry([runtimeBeforeCrash]),
      "activation-before-crash-supervisor",
      { leaseMs: 5_000, batchSize: 1, retryBackoffMs: 0 },
    );

    await supervisorBeforeCrash.tick();
    await waitForExecutionTerminal(db, incoming.messageId, recipient.id, 1);

    const runtimeAfterCrash = new ModelBackedWorkerRuntime(db, registry, coordination);
    const supervisorAfterCrash = new CoordinationActivationSupervisor(
      db,
      new WorkerStore(db),
      new RuntimeRegistry([runtimeAfterCrash]),
      "activation-after-crash-supervisor",
      { leaseMs: 5_000, batchSize: 1, retryBackoffMs: 0 },
    );

    await supervisorAfterCrash.tick();
    const afterRestart = await activationState(db, incoming.messageId, recipient.id);
    assert.equal(afterRestart.state, "pending");
    assert.equal(Number(afterRestart.activation_attempts), 1);

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

    await supervisorAfterCrash.tick();
    await waitForExecutionTerminal(db, incoming.messageId, recipient.id, 2);
    await supervisorAfterCrash.tick();

    const activation = await activationState(db, incoming.messageId, recipient.id);
    assert.equal(activation.state, "completed");
    assert.equal(Number(activation.activation_attempts), 2);
    const delivery = await deliveryState(db, incoming.messageId, recipient.id);
    assert.equal(delivery.state, "acknowledged");
    assert.equal(Number(delivery.delivery_attempts), 2);
    assert.equal(adapterCalls, 2);
    assert.equal(await executionCount(db, recipient.id), 2);

    const worker = await db.query(
      `SELECT status,runtime_handle FROM sentient_workers WHERE id=$1`,
      [recipient.id],
    );
    assert.equal(worker.rows[0].status, "waiting");
    assert.equal(worker.rows[0].runtime_handle, null);
  } finally {
    if (taskId) await db.query(`DELETE FROM tasks WHERE id=$1`, [taskId]);
    await db.end();
  }
});

