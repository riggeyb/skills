import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { CoordinationActivationSupervisor } from "../src/coordination-activation-supervisor.js";
import { SentientCoordinationService } from "../src/sentient-coordination.js";
import {
  RuntimeRegistry,
  type RuntimeRequirements,
  type SentientWorker,
  type WorkerActivationRequest,
  type WorkerRuntime,
  type WorkerRuntimeState,
} from "../src/worker-control.js";
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

test("binding loss prevents assign/provider-start and coordination side effects", { skip: !url }, async () => {
  const db = new Pool({ connectionString: url! });
  let taskId: string | undefined;
  try {
    taskId = await createTask(db);
    const recipient = await createWorker(db, taskId, "binding-recipient");
    const sender = await createWorker(db, taskId, "binding-sender");
    const coordination = new SentientCoordinationService(db);
    const incoming = await coordination.send(actor(sender), {
      target: { kind: "worker", workerId: recipient.id },
      type: "QUESTION",
      correlationId: "activation:binding-loss",
      payload: { question: "Do not start before durable binding." },
    });

    let assignCalls = 0;
    let cancelCalls = 0;
    const runtime: WorkerRuntime = {
      id: "model-backed",
      compatible: (_requirements: RuntimeRequirements) => true,
      async spawn(worker: SentientWorker) {
        return { handle: `binding-test:spawn:${worker.id}` };
      },
      async activate(
        _worker: SentientWorker,
        _requirements: RuntimeRequirements,
        activation: WorkerActivationRequest,
      ) {
        await db.query(
          `UPDATE sentient_coordination_activations
           SET claim_owner='competing-supervisor',updated_at=now()
           WHERE activation_id=$1`,
          [activation.activationId],
        );
        return { handle: `binding-test:${activation.activationId}` };
      },
      async assign(_handle: string, _assignment: unknown) {
        assignCalls++;
      },
      async inspect(_handle: string): Promise<WorkerRuntimeState> {
        return { status: "starting", spentUsd: 0 };
      },
      async cancel(_handle: string, _reason: string) {
        cancelCalls++;
      },
      async terminate(_handle: string, _reason: string) {},
    };

    const supervisor = new CoordinationActivationSupervisor(
      db,
      new WorkerStore(db),
      new RuntimeRegistry([runtime]),
      "binding-owner-supervisor",
      { leaseMs: 5_000, batchSize: 1, retryBackoffMs: 0 },
    );

    await supervisor.tick();

    assert.equal(assignCalls, 0);
    assert.equal(cancelCalls, 1);
    const delivery = await deliveryState(db, incoming.messageId, recipient.id);
    assert.equal(delivery.state, "pending");
    assert.equal(Number(delivery.delivery_attempts), 0);
    const outgoing = await db.query(
      `SELECT count(*)::int AS n
       FROM sentient_coordination_messages
       WHERE sender_worker_id=$1`,
      [recipient.id],
    );
    assert.equal(Number(outgoing.rows[0].n), 0);
    const executionRows = await db.query(
      `SELECT count(*)::int AS n
       FROM worker_coordination_runtime_executions
       WHERE worker_id=$1`,
      [recipient.id],
    );
    assert.equal(Number(executionRows.rows[0].n), 0);
    const activation = await activationState(db, incoming.messageId, recipient.id);
    assert.equal(activation.state, "pending");
    assert.equal(Number(activation.activation_attempts), 1);
  } finally {
    if (taskId) await db.query(`DELETE FROM tasks WHERE id=$1`, [taskId]);
    await db.end();
  }
});

