import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { SentientCoordinationService } from "../src/sentient-coordination.js";
import {
  DIRECT_COORDINATION_RULE,
  type CoordinationActor,
} from "../src/sentient-coordination-types.js";

const url = process.env.DATABASE_URL;
const repo = { owner: "riggeyb", repo: "skills" };

interface Fixture {
  taskId: string;
  tenant: string;
  lead: CoordinationActor;
  workerA: CoordinationActor;
  workerB: CoordinationActor;
}

async function createTask(db: Pool, tenant = `coord:${randomUUID()}`): Promise<Fixture> {
  const delivery = randomUUID();
  const taskId = (await db.query(
    `INSERT INTO tasks(delivery_id,objective,status,origin)
     VALUES($1,'coordination transport','running',$2)
     RETURNING id`,
    [delivery, {
      repository: repo,
      issueNumber: 66,
      installationId: 1,
      deliveryId: delivery,
      requestedBy: "sentient-coordination-test",
    }],
  )).rows[0].id as string;

  const lead = await createWorker(db, taskId, tenant, "lead");
  const workerA = await createWorker(db, taskId, tenant, "backend");
  const workerB = await createWorker(db, taskId, tenant, "tests");
  await db.query(
    `INSERT INTO task_leadership(task_id,lead_worker_id,epoch,lease_expires_at)
     VALUES($1,$2,2,now()+interval '10 minutes')`,
    [taskId, lead.workerId],
  );
  return { taskId, tenant, lead, workerA, workerB };
}

async function createWorker(
  db: Pool,
  taskId: string,
  tenant: string,
  role: string,
  repository = repo,
  status = "running",
): Promise<CoordinationActor> {
  const correlationId = `coord:${randomUUID()}`;
  const spawn = (await db.query(
    `INSERT INTO worker_spawn_requests(
       task_id,tenant,repository_owner,repository_name,role,subtask,
       idempotency_key,correlation_id,status
     )
     VALUES($1,$2,$3,$4,$5,'{}'::jsonb,$6,$7,'completed')
     RETURNING id`,
    [taskId, tenant, repository.owner, repository.repo, role, randomUUID(), correlationId],
  )).rows[0].id as string;
  const workerId = (await db.query(
    `INSERT INTO sentient_workers(
       spawn_request_id,task_id,tenant,repository_owner,repository_name,role,
       assignment,status,runtime_id,correlation_id,attempt_count
     )
     VALUES($1,$2,$3,$4,$5,$6,'{}'::jsonb,$7,'coordination-test',$8,1)
     RETURNING id`,
    [spawn, taskId, tenant, repository.owner, repository.repo, role, status, correlationId],
  )).rows[0].id as string;
  return { workerId, taskId, tenant, repository, attemptCount: 1 };
}

async function cleanup(db: Pool, taskIds: string[]): Promise<void> {
  await db.query(`DELETE FROM tasks WHERE id=ANY($1::uuid[])`, [taskIds]);
}

test("durable direct delivery is ordered, restart-safe, replay-safe, and ack-idempotent", { skip: !url }, async () => {
  const db = new Pool({ connectionString: url! });
  const taskIds: string[] = [];
  try {
    const f = await createTask(db);
    taskIds.push(f.taskId);
    const service = new SentientCoordinationService(db);
    const firstId = randomUUID();
    const first = {
      messageId: firstId,
      target: { kind: "worker" as const, workerId: f.workerB.workerId },
      type: "QUESTION" as const,
      correlationId: "corr:question",
      payload: { question: "Which interface owns this dependency?" },
    };
    const sent = await service.send(f.workerA, first);
    const replay = await service.send(f.workerA, first);
    assert.equal(sent.messageId, replay.messageId);
    assert.equal(sent.senderWorkerId, f.workerA.workerId);
    assert.equal(sent.recipientWorkerId, f.workerB.workerId);
    assert.equal(sent.correlationId, "corr:question");

    await assert.rejects(
      service.send(f.workerA, { ...first, payload: { question: "different" } }),
      /message id already bound to different content/,
    );

    const second = await service.send(f.workerA, {
      target: { kind: "worker", workerId: f.workerB.workerId },
      type: "FINDING",
      correlationId: "corr:finding",
      payload: { finding: "Shared interface is worker-protocol." },
    });

    const inbox = await service.inbox(f.workerB, { redeliveryAfterMs: 0 });
    assert.deepEqual(inbox.map((item) => item.message.messageId), [firstId, second.messageId]);
    assert.deepEqual(inbox.map((item) => item.deliveryAttempts), [1, 1]);

    // A fresh service instance proves redelivery state is PostgreSQL-backed.
    const restarted = new SentientCoordinationService(db);
    const redelivered = await restarted.inbox(f.workerB, { redeliveryAfterMs: 0 });
    assert.deepEqual(redelivered.map((item) => item.message.messageId), [firstId, second.messageId]);
    assert.deepEqual(redelivered.map((item) => item.deliveryAttempts), [2, 2]);

    const ack = await restarted.ack(f.workerB, firstId);
    assert.deepEqual(ack, { acknowledged: true, alreadyAcknowledged: false });
    const again = await restarted.ack(f.workerB, firstId);
    assert.deepEqual(again, { acknowledged: true, alreadyAcknowledged: true });

    const answer = await restarted.send(f.workerB, {
      target: { kind: "worker", workerId: f.workerA.workerId },
      type: "ANSWER",
      correlationId: sent.correlationId,
      causationId: firstId,
      payload: { answer: "The accepted worker protocol owns it." },
    });
    assert.equal(answer.causationId, firstId);
    const answerInbox = await restarted.inbox(f.workerA);
    assert.equal(answerInbox[0]?.message.causationId, firstId);
    assert.equal(answerInbox[0]?.message.correlationId, "corr:question");

    const deliveryCount = await db.query(
      `SELECT count(*)::int n
       FROM sentient_coordination_deliveries
       WHERE message_id=$1`,
      [firstId],
    );
    assert.equal(deliveryCount.rows[0].n, 1);
  } finally {
    await cleanup(db, taskIds);
    await db.end();
  }
});

test("coordination rejects spoofing, cross-boundary injection, private reasoning, and terminal recipients", { skip: !url }, async () => {
  const db = new Pool({ connectionString: url! });
  const taskIds: string[] = [];
  try {
    const f = await createTask(db);
    const other = await createTask(db, `other:${randomUUID()}`);
    taskIds.push(f.taskId, other.taskId);
    const service = new SentientCoordinationService(db);

    await assert.rejects(
      service.send({ ...f.workerA, taskId: other.taskId }, {
        target: { kind: "worker", workerId: f.workerB.workerId },
        type: "QUESTION",
        payload: { q: "spoof" },
      }),
      /actor task mismatch/,
    );
    await assert.rejects(
      service.send(f.workerA, {
        target: { kind: "worker", workerId: other.workerA.workerId },
        type: "QUESTION",
        payload: { q: "cross task" },
      }),
      /task boundary violation/,
    );

    const tenantMismatch = await createWorker(db, f.taskId, `wrong:${randomUUID()}`, "reviewer");
    await assert.rejects(
      service.send(f.workerA, {
        target: { kind: "worker", workerId: tenantMismatch.workerId },
        type: "QUESTION",
        payload: { q: "cross tenant" },
      }),
      /tenant boundary violation/,
    );

    const repoMismatch = await createWorker(db, f.taskId, f.tenant, "reviewer", { owner: "other", repo: "repo" });
    await assert.rejects(
      service.send(f.workerA, {
        target: { kind: "worker", workerId: repoMismatch.workerId },
        type: "QUESTION",
        payload: { q: "cross repo" },
      }),
      /repository boundary violation/,
    );

    await assert.rejects(
      service.send(f.workerA, {
        target: { kind: "worker", workerId: f.workerB.workerId },
        type: "FINDING",
        payload: { nested: { chainOfThought: "must not persist" } },
      }),
      /forbidden message field/,
    );

    await db.query(`UPDATE sentient_workers SET status='cancelled' WHERE id=$1`, [f.workerB.workerId]);
    await assert.rejects(
      service.send(f.workerA, {
        target: { kind: "worker", workerId: f.workerB.workerId },
        type: "STATUS",
        payload: { status: "hello" },
      }),
      /recipient is cancelled/,
    );

    await db.query(`UPDATE sentient_workers SET status='running' WHERE id=$1`, [f.workerB.workerId]);
    const pending = await service.send(f.workerA, {
      target: { kind: "worker", workerId: f.workerB.workerId },
      type: "STATUS",
      payload: { status: "pending" },
    });
    await db.query(`UPDATE sentient_workers SET status='expired' WHERE id=$1`, [f.workerB.workerId]);
    assert.deepEqual(await new SentientCoordinationService(db).inbox(f.workerB), []);
    const dead = await db.query(
      `SELECT state,dead_letter_reason
       FROM sentient_coordination_deliveries
       WHERE message_id=$1 AND recipient_worker_id=$2`,
      [pending.messageId, f.workerB.workerId],
    );
    assert.deepEqual(dead.rows[0], { state: "dead_letter", dead_letter_reason: "recipient_terminal" });
  } finally {
    await cleanup(db, taskIds);
    await db.end();
  }
});

test("Lead directives are epoch-fenced and Lead/task broadcasts materialize only authorized recipients", { skip: !url }, async () => {
  const db = new Pool({ connectionString: url! });
  const taskIds: string[] = [];
  try {
    const f = await createTask(db);
    taskIds.push(f.taskId);
    const service = new SentientCoordinationService(db);

    await assert.rejects(
      service.send(f.workerA, {
        target: { kind: "worker", workerId: f.workerB.workerId },
        type: "DIRECTIVE",
        leadershipEpoch: 2,
        payload: { action: "do not allow specialist directives" },
      }),
      /Lead role required/,
    );
    await assert.rejects(
      service.send(f.lead, {
        target: { kind: "worker", workerId: f.workerA.workerId },
        type: "DIRECTIVE",
        leadershipEpoch: 1,
        payload: { action: "stale" },
      }),
      /not active Lead for epoch/,
    );

    const directive = await service.send(f.lead, {
      target: { kind: "worker", workerId: f.workerA.workerId },
      type: "DIRECTIVE",
      leadershipEpoch: 2,
      payload: { action: "review dependency" },
    });
    assert.equal(directive.leadershipEpoch, 2);

    const toLead = await service.send(f.workerA, {
      target: { kind: "lead" },
      type: "ESCALATION",
      payload: { reason: "human authority not required; ask Lead first" },
    });
    assert.equal((await service.inbox(f.lead)).some((d) => d.message.messageId === toLead.messageId), true);

    const broadcast = await service.send(f.workerA, {
      target: { kind: "task" },
      type: "FINDING",
      payload: { finding: "task-scoped broadcast" },
    });
    const recipients = await db.query(
      `SELECT recipient_worker_id
       FROM sentient_coordination_deliveries
       WHERE message_id=$1
       ORDER BY recipient_worker_id`,
      [broadcast.messageId],
    );
    assert.deepEqual(
      new Set(recipients.rows.map((row) => row.recipient_worker_id)),
      new Set([f.lead.workerId, f.workerB.workerId]),
    );

    await db.query(`UPDATE task_leadership SET epoch=3 WHERE task_id=$1`, [f.taskId]);
    await assert.rejects(
      service.send(f.lead, {
        target: { kind: "worker", workerId: f.workerA.workerId },
        type: "DECISION",
        leadershipEpoch: 2,
        payload: { decision: "stale" },
      }),
      /not active Lead for epoch/,
    );

    assert.match(DIRECT_COORDINATION_RULE, /Never ask the human operator to relay/);
  } finally {
    await cleanup(db, taskIds);
    await db.end();
  }
});
