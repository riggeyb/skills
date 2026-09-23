import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { WorkerStore } from "../src/worker-store.js";

const url = process.env.DATABASE_URL;

async function task(db: Pool, label: string) {
  const deliveryId = randomUUID();
  return (
    await db.query(
      `INSERT INTO tasks(delivery_id,objective,status,origin)
       VALUES($1,$2,'running','{}'::jsonb)
       RETURNING id`,
      [deliveryId, label],
    )
  ).rows[0].id as string;
}

async function request(db: Pool, taskId: string, maxAttempts = 2) {
  return (
    await db.query(
      `INSERT INTO worker_spawn_requests(
         task_id,tenant,repository_owner,repository_name,role,subtask,
         required_capabilities,idempotency_key,correlation_id,status,
         attempt_count,max_attempts,next_attempt_at
       )
       VALUES(
         $1,$2,'riggeyb','skills','specialist','{}'::jsonb,
         ARRAY['test'],$3,$4,'claimed',0,$5,now()
       )
       RETURNING *`,
      [taskId, `verification-${randomUUID()}`, randomUUID(), randomUUID(), maxAttempts],
    )
  ).rows[0];
}

test("retries create distinct attempts, preserve terminal attempts, and enforce retry limits", { skip: !url }, async () => {
  const db = new Pool({ connectionString: url! });
  try {
    const taskId = await task(db, "retry-attempts");
    const store = new WorkerStore(db);
    const q1 = await request(db, taskId, 2);

    const first = await store.create(q1, "deterministic", "scheduler");
    assert.equal(first.attemptCount, 1);
    await store.transition(first.id, "failed", "first failure");
    assert.equal(await store.retry(await store.get(first.id), "first failure"), true);

    const q2 = (
      await db.query(
        `SELECT * FROM worker_spawn_requests WHERE id=$1`,
        [q1.id],
      )
    ).rows[0];
    assert.equal(q2.status, "pending");

    const second = await store.create(q2, "deterministic", "scheduler");
    assert.notEqual(second.id, first.id);
    assert.equal(second.attemptCount, 2);

    const firstReloaded = await store.get(first.id);
    assert.equal(firstReloaded.status, "failed");
    await assert.rejects(
      store.transition(first.id, "starting"),
      /Illegal worker transition/,
    );

    await store.transition(second.id, "failed", "second failure");
    assert.equal(await store.retry(await store.get(second.id), "second failure"), false);

    const requestRow = await db.query(
      `SELECT attempt_count,status
       FROM worker_spawn_requests
       WHERE id=$1`,
      [q1.id],
    );
    assert.equal(Number(requestRow.rows[0].attempt_count), 2);
    assert.equal(requestRow.rows[0].status, "failed");

    const attempts = await db.query(
      `SELECT id,attempt_count,status
       FROM sentient_workers
       WHERE spawn_request_id=$1
       ORDER BY attempt_count`,
      [q1.id],
    );
    assert.deepEqual(
      attempts.rows.map(row => [row.id, Number(row.attempt_count), row.status]),
      [
        [first.id, 1, "failed"],
        [second.id, 2, "failed"],
      ],
    );
  } finally {
    await db.end();
  }
});

test("blocked spawn requests respect next_attempt_at and become claimable only after recheck time", { skip: !url }, async () => {
  const db = new Pool({ connectionString: url! });
  const lock = await db.connect();
  try {
    const taskId = await task(db, "blocked-backoff");
    const store = new WorkerStore(db);
    const q = await request(db, taskId, 3);
    await store.block(q.id, "dependency_pending", 60_000);

    await lock.query("BEGIN");
    await lock.query(
      `SELECT id
       FROM worker_spawn_requests
       WHERE id<>$1
       FOR UPDATE`,
      [q.id],
    );
    const premature = await store.claim("backoff-check");
    assert.equal(premature, null);
    await lock.query("ROLLBACK");

    const timing = await db.query(
      `SELECT status,next_attempt_at>now() AS deferred
       FROM worker_spawn_requests
       WHERE id=$1`,
      [q.id],
    );
    assert.equal(timing.rows[0].status, "blocked");
    assert.equal(timing.rows[0].deferred, true);

    await db.query(
      `UPDATE worker_spawn_requests
       SET next_attempt_at=now()-interval '1 second'
       WHERE id=$1`,
      [q.id],
    );

    await lock.query("BEGIN");
    await lock.query(
      `SELECT id
       FROM worker_spawn_requests
       WHERE id<>$1
       FOR UPDATE`,
      [q.id],
    );
    const due = await store.claim("backoff-check");
    assert.equal(due.id, q.id);
    await lock.query("ROLLBACK");
  } finally {
    try {
      await lock.query("ROLLBACK");
    } catch {}
    lock.release();
    await db.end();
  }
});
