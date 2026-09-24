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
import { DIRECT_COORDINATION_RULE } from "../src/sentient-coordination-types.js";
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

test("QUESTION wakes A, A ACKs siblings and sends ANSWER, then B wakes and ACKs ANSWER", { skip: !url }, async () => {
  const db = new Pool({ connectionString: url! });
  let taskId: string | undefined;
  try {
    taskId = await createTask(db);
    const workerA = await createWorker(db, taskId, "roundtrip-a");
    const workerB = await createWorker(db, taskId, "roundtrip-b");
    const coordination = new SentientCoordinationService(db);

    const question = await coordination.send(actor(workerB), {
      target: { kind: "worker", workerId: workerA.id },
      type: "QUESTION",
      correlationId: "activation:roundtrip",
      payload: { question: "Can you answer directly?" },
    });
    const siblingStatus = await coordination.send(actor(workerB), {
      target: { kind: "worker", workerId: workerA.id },
      type: "STATUS",
      correlationId: "activation:roundtrip",
      payload: { status: "context-one" },
    });
    const siblingFinding = await coordination.send(actor(workerB), {
      target: { kind: "worker", workerId: workerA.id },
      type: "FINDING",
      correlationId: "activation:roundtrip",
      payload: { finding: "context-two" },
    });
    const beforeCount = await workerCount(db, taskId);

    let aCalls = 0;
    let bCalls = 0;
    const adapter: ModelExecutionAdapter = {
      id: "activation-roundtrip-adapter",
      providerId: "test-provider",
      compatible: (requirements) => requirements.capabilities.includes("coord-activation-test"),
      async execute(request): Promise<ModelExecutionResponse> {
        assert.equal(request.coordination?.behavioralRule, DIRECT_COORDINATION_RULE);
        const pending = request.coordination?.pending ?? [];

        if (request.identity.workerId === workerA.id) {
          aCalls++;
          assert.equal(request.coordinationActivation?.triggerMessageId, question.messageId);
          assert.equal(request.coordinationActivation?.activationAttempt, 1);
          const pendingIds = new Set(pending.map((delivery) => delivery.message.messageId));
          assert.ok(pendingIds.has(question.messageId));
          assert.ok(pendingIds.has(siblingStatus.messageId));
          assert.ok(pendingIds.has(siblingFinding.messageId));
          return {
            status: "completed",
            conclusion: "A answered B directly",
            evidence: [],
            artifacts: [],
            toolResults: [],
            coordinationActions: [
              { kind: "ack", messageId: question.messageId },
              { kind: "ack", messageId: siblingStatus.messageId },
              { kind: "ack", messageId: siblingFinding.messageId },
              {
                kind: "send",
                draft: {
                  target: { kind: "worker", workerId: workerB.id },
                  type: "ANSWER",
                  correlationId: question.correlationId,
                  causationId: question.messageId,
                  payload: { answer: "yes" },
                },
              },
            ],
            usage: { costUsd: 0.01 },
          };
        }

        if (request.identity.workerId === workerB.id) {
          bCalls++;
          const triggerMessageId = request.coordinationActivation?.triggerMessageId;
          assert.ok(trigggerMessageId);
          const trigger = pending.find((delivery) => delivery.message.messageId === triggerMessageId);
          assert.ok(trigger);
          assert.equal(trigger.message.type, "ANSWER");
          assert.equal(trigger.message.causationId, question.messageId);
          return {
            status: "completed",
            conclusion: "B consumed A's answer",
            evidence: [],
            artifacts: [],
            toolResults: [],
            coordinationActions: [{ kind: "ack", messageId: triggerMessageId }],
            usage: { costUsd: 0.01 },
          };
        }

        throw new Error("unexpected_activation_worker");
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
      "activation-roundtrip-supervisor",
      { leaseMs: 5_000, batchSize: 8, retryBackoffMs: 0 },
    );

    await supervisor.tick();
    await waitForExecutionTerminal(db, question.messageId, workerA.id, 1);

    const answer = await db.query(
      `SELECT message_id,recipient_worker_id,correlation_id,causation_id
       FROM sentient_coordination_messages
       WHERE sender_worker_id=$1 AND message_type='ANSWER'`,
      [workerA.id],
    );
    assert.equal(answer.rowCount, 1);
    const answerId = String(answer.rows[0].message_id);
    assert.equal(answer.rows[0].recipient_worker_id, workerB.id);
    assert.equal(answer.rows[0].correlation_id, question.correlationId);
    assert.equal(answer.rows[0].causation_id, question.messageId);

    await supervisor.tick();
    await waitForExecutionTerminal(db, answerId, workerB.id, 1);
    await supervisor.tick();

    for (const [messageId, workerId] of [
      [question.messageId, workerA.id],
      [siblingStatus.messageId, workerA.id],
      [siblingFinding.messageId, workerA.id],
      [answerId, workerB.id],
    ] as const) {
      const delivery = await deliveryState(db, messageId, workerId);
      assert.equal(delivery.state, "acknowledged");
    }

    const questionActivation = await activationState(db, question.messageId, workerA.id);
    const statusActivation = await activationState(db, siblingStatus.messageId, workerA.id);
    const findingActivation = await activationState(db, siblingFinding.messageId, workerA.id);
    const answerActivation = await activationState(db, answerId, workerB.id);
    assert.equal(questionActivation.state, "completed");
    assert.equal(Number(questionActivation.activation_attempts), 1);
    assert.equal(statusActivation.state, "completed");
    assert.equal(Number(statusActivation.activation_attempts), 0);
    assert.equal(findingActivation.state, "completed");
    assert.equal(Number(findingActivation.activation_attempts), 0);
    assert.equal(answerActivation.state, "completed");
    assert.equal(Number(answerActivation.activation_attempts), 1);

    const aExecutions = await executionCount(db, workerA.id);
    const bExecutions = await executionCount(db, workerB.id);
    assert.equal(aExecutions, 1);
    assert.equal(bExecutions, 1);
    assert.equal(aCalls, 1);
    assert.equal(bCalls, 1);
    assert.equal(await workerCount(db, taskId), beforeCount);

    for (const worker of [workerA, workerB]) {
      const row = await db.query(
        `SELECT status,runtime_handle FROM sentient_workers WHERE id=$1`,
        [worker.id],
      );
      assert.equal(row.rows[0].status, "waiting");
      assert.equal(row.rows[0].runtime_handle, null);
    }

    await supervisor.tick();
    assert.equal(await executionCount(db, workerA.id), 1);
    assert.equal(await executionCount(db, workerB.id), 1);
  } finally {
    if (taskId) await db.query(`DELETE FROM tasks WHERE id=$1`, [taskId]);
    await db.end();
  }
});
