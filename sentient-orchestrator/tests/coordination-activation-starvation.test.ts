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

test("activation trigger cannot starve behind more than 150 older inbox messages", { skip: !url }, async () => {
  const db = new Pool({ connectionString: url! });
  let taskId: string | undefined;
  try {
    taskId = await createTask(db);
    const recipient = await createWorker(db, taskId, "starvation-recipient");
    const sender = await createWorker(db, taskId, "starvation-sender");
    const coordination = new SentientCoordinationService(db);

    const backlogIds: string[] = [];
    for (let index = 0; index < 160; index++) {
      const message = await coordination.send(actor(sender), {
        target: { kind: "worker", workerId: recipient.id },
        type: "STATUS",
        correlationId: "activation:starvation",
        payload: { index },
      });
      backlogIds.push(message.messageId);
    }
    const trigger = await coordination.send(actor(sender), {
      target: { kind: "worker", workerId: recipient.id },
      type: "QUESTION",
      correlationId: "activation:starvation",
      payload: { question: "This trigger must not starve." },
    });

    const retiredBacklog = await db.query(
      `UPDATE sentient_coordination_activations
       SET state='dead_letter',last_error='starvation_fixture_retired_activation',
           completed_at=now(),updated_at=now()
       WHERE recipient_worker_id=$1 AND message_id=ANY($2::uuid[])
       RETURNING activation_id`,
      [recipient.id, backlogIds],
    );
    assert.equal(retiredBacklog.rowCount, backlogIds.length);

    let adapterCalls = 0;
    const adapter: ModelExecutionAdapter = {
      id: "activation-starvation-adapter",
      providerId: "test-provider",
      compatible: (requirements) => requirements.capabilities.includes("coord-activation-test"),
      async execute(request): Promise<ModelExecutionResponse> {
        adapterCalls++;
        assert.equal(request.coordinationActivation?.triggerMessageId, trigger.messageId);
        assert.equal(request.coordinationActivation?.activationAttempt, 1);
        const pending = request.coordination?.pending ?? [];
        assert.equal(pending.length, 50);
        assert.equal(pending[0]?.message.messageId, trigger.messageId);
        assert.ok(pending.some((delivery) => delivery.message.messageId === trigger.messageId));
        return {
          status: "completed",
          conclusion: "trigger was presented despite backlog",
          evidence: [],
          artifacts: [],
          toolResults: [],
          coordinationActions: [{ kind: "ack", messageId: trigger.messageId }],
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
      "activation-starvation-supervisor",
      { leaseMs: 5_000, batchSize: 1, retryBackoffMs: 0 },
    );

    await supervisor.tick();
    await waitForExecutionTerminal(db, trigger.messageId, recipient.id, 1);
    await supervisor.tick();

    const activation = await activationState(db, trigger.messageId, recipient.id);
    assert.equal(activation.state, "completed");
    assert.equal(Number(activation.activation_attempts), 1);
    assert.equal(Number(activation.max_activation_attempts), 3);
    const delivery = await deliveryState(db, trigger.messageId, recipient.id);
    assert.equal(delivery.state, "acknowledged");
    assert.equal(Number(delivery.delivery_attempts), 1);
    assert.equal(adapterCalls, 1);
  } finally {
    if (taskId) await db.query(`DELETE FROM tasks WHERE id=$1`, [taskId]);
    await db.end();
  }
});

