import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import {
  ModelExecutionAdapterRegistry,
  type ModelExecutionAdapter,
  type ModelExecutionResponse,
} from "../src/model-execution.js";
import { ModelBackedWorkerRuntime } from "../src/model-backed-worker-runtime.js";
import { SentientCoordinationService } from "../src/sentient-coordination.js";
import { DIRECT_COORDINATION_RULE } from "../src/sentient-coordination-types.js";
import type { SentientWorker } from "../src/worker-control.js";

const url = process.env.DATABASE_URL;
const repository = { owner: "riggeyb", repo: "skills" };

test("model runtime exposes durable inbox and applies provider send/ack through worker identity", { skip: !url }, async () => {
  const db = new Pool({ connectionString: url! });
  let taskId: string | undefined;
  try {
    taskId = await createTask(db);
    const worker = await createWorker(db, taskId, "model");
    const peer = await createWorker(db, taskId, "peer");
    const coordination = new SentientCoordinationService(db);
    const incoming = await coordination.send(actor(peer), {
      target: { kind: "worker", workerId: worker.id },
      type: "QUESTION",
      correlationId: "coord:runtime",
      payload: { question: "Who owns the protocol boundary?" },
    });

    const adapter: ModelExecutionAdapter = {
      id: "coord-adapter",
      providerId: "test-provider",
      compatible: (requirements) => requirements.capabilities.includes("coord-test"),
      async execute(request, context): Promise<ModelExecutionResponse> {
        assert.equal(request.coordination?.behavioralRule, DIRECT_COORDINATION_RULE);
        assert.equal(request.coordination?.pending[0]?.message.messageId, incoming.messageId);
        assert.ok(context.coordination);
        assert.equal("senderWorkerId" in (request.coordination ?? {}), false);
        return {
          status: "completed",
          conclusion: "answered peer directly",
          evidence: [],
          artifacts: [],
          toolResults: [],
          coordinationActions: [
            { kind: "ack", messageId: incoming.messageId },
            {
              kind: "send",
              draft: {
                target: { kind: "worker", workerId: peer.id },
                type: "ANSWER",
                correlationId: incoming.correlationId,
                causationId: incoming.messageId,
                payload: { answer: "The accepted worker protocol owns the boundary." },
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
    const { handle } = await runtime.spawn(worker, {
      capabilities: ["coord-test"],
      maxCostUsd: 1,
    });
    await runtime.assign(handle, worker.assignment);
    const state = await terminal(runtime, handle);
    assert.equal(state.status, "completed");

    const ack = await db.query(
      `SELECT state FROM sentient_coordination_deliveries
       WHERE message_id=$1 AND recipient_worker_id=$2`,
      [incoming.messageId, worker.id],
    );
    assert.equal(ack.rows[0]?.state, "acknowledged");

    const answer = await db.query(
      `SELECT sender_worker_id,recipient_worker_id,correlation_id,causation_id,payload
       FROM sentient_coordination_messages
       WHERE sender_worker_id=$1 AND message_type='ANSWER'`,
      [worker.id],
    );
    assert.equal(answer.rowCount, 1);
    assert.equal(answer.rows[0].sender_worker_id, worker.id);
    assert.equal(answer.rows[0].recipient_worker_id, peer.id);
    assert.equal(answer.rows[0].correlation_id, incoming.correlationId);
    assert.equal(answer.rows[0].causation_id, incoming.messageId);
  } finally {
    if (taskId) await db.query(`DELETE FROM tasks WHERE id=$1`, [taskId]);
    await db.end();
  }
});

async function createTask(db: Pool): Promise<string> {
  const deliveryId = randomUUID();
  const result = await db.query(
    `INSERT INTO tasks(delivery_id,objective,status,origin)
     VALUES($1,'model coordination runtime test','running',$2::jsonb)
     RETURNING id`,
    [deliveryId, JSON.stringify({ repository, deliveryId, requestedBy: "coord-runtime-test" })],
  );
  return result.rows[0].id;
}

async function createWorker(db: Pool, taskId: string, role: string): Promise<SentientWorker> {
  const tenant = `coord-runtime:${taskId}`;
  const correlationId = `coord-runtime:${randomUUID()}`;
  const assignment = { objective: `${role} coordination` };
  const spawn = await db.query(
    `INSERT INTO worker_spawn_requests(
       task_id,tenant,repository_owner,repository_name,role,subtask,required_capabilities,
       max_cost_usd,idempotency_key,correlation_id,status
     )
     VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,1,$8,$9,'scheduled')
     RETURNING id`,
    [
      taskId, tenant, repository.owner, repository.repo, role, JSON.stringify(assignment),
      ["coord-test"], randomUUID(), correlationId,
    ],
  );
  const spawnRequestId = spawn.rows[0].id;
  const row = await db.query(
    `INSERT INTO sentient_workers(
       spawn_request_id,task_id,tenant,repository_owner,repository_name,role,assignment,status,
       capabilities,authority,budget_usd,attempt_count,correlation_id
     )
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,'assigned',$8,'{}'::jsonb,1,1,$9)
     RETURNING id`,
    [
      spawnRequestId, taskId, tenant, repository.owner, repository.repo, role,
      JSON.stringify(assignment), ["coord-test"], correlationId,
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
    status: "assigned",
    attemptCount: 1,
    budgetUsd: 1,
    spentUsd: 0,
    correlationId,
    capabilities: ["coord-test"],
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

async function terminal(runtime: ModelBackedWorkerRuntime, handle: string) {
  for (let index = 0; index < 100; index++) {
    const state = await runtime.inspect(handle);
    if (["completed", "failed", "cancelled"].includes(state.status)) return state;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("model runtime did not reach terminal state");
}
