import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { LeadOrchestrationError, LeadOrchestrationStore } from "../src/lead-orchestration.js";

const url = process.env.DATABASE_URL;

async function task(db: Pool) {
  const delivery = randomUUID();
  return (await db.query(
    `INSERT INTO tasks(delivery_id,objective,status,origin)
     VALUES($1,'handoff integrity','running','{}'::jsonb) RETURNING id`,
    [delivery],
  )).rows[0].id as string;
}

async function worker(db: Pool, taskId: string, role: "lead" | "specialist") {
  const spawn = (await db.query(
    `INSERT INTO worker_spawn_requests(
       task_id,tenant,repository_owner,repository_name,role,subtask,idempotency_key,correlation_id
     ) VALUES($1,'tenant-a','riggeyb','skills',$2,'{}'::jsonb,$3,$4) RETURNING id`,
    [taskId, role, randomUUID(), randomUUID()],
  )).rows[0].id as string;
  return (await db.query(
    `INSERT INTO sentient_workers(
       spawn_request_id,task_id,tenant,repository_owner,repository_name,role,assignment,status,correlation_id
     ) VALUES($1,$2,'tenant-a','riggeyb','skills',$3,'{}'::jsonb,'running',$4) RETURNINC id`,
    [spawn, taskId, role, randomUUID()],
  )).rows[0].id as string;
}

test("review must reference the handoff that was actually submitted", { skip: !url }, async () => {
  const db = new Pool({ connectionString: url! });
  try {
    const taskId = await task(db);
    const leadId = await worker(db, taskId, "lead");
    const specialistId = await worker(db, taskId, "specialist");
    const store = new LeadOrchestrationStore(db);
    const leadership = await store.acquireLeadership(taskId, leadId, 60_000);

    await store.assign({
      taskId,
      leadWorkerId: leadId,
      epoch: leadership.epoch,
      externalId: "handoff-assignment",
      idempotencyKey: randomUUID(),
      targetWorkerId: specialistId,
      objective: "produce handoff",
      assignment: {},
      acceptanceCriteria: [],
      dependencies: [],
      required: true,
    });
    await store.submitHandoff(taskId, "handoff-assignment", specialistId, {
      handoffId: "handoff-real",
      summary: "evidence",
    });

    await assert.rejects(
      store.review({
        taskId,
        leadWorkerId: leadId,
        epoch: leadership.epoch,
        assignmentId: "handoff-assignment",
        handoffId: "handoff-forged",
        decision: "accepted",
      }),
      (error: unknown) =>
        error instanceof LeadOrchestrationError &&
        ["UNKNOWN_HANDOFF", "HANDOFF_MISMATCH"].includes(error.code),
    );

    const afterForgery = await db.query(
      `SELECT status,last_review FROM worker_assignments
       WHERE task_id=$1 AND external_id='handoff-assignment'`,
      [taskId],
    );
    assert.equal(afterForgery.rows[0].status, "handed_off");
    assert.equal(afterForgery.rows[0].last_review, null);

    await store.review({
      taskId,
      leadWorkerId: leadId,
      epoch: leadership.epoch,
      assignmentId: "handoff-assignment",
      handoffId: "handoff-real",
      decision: "accepted",
    });
    assert.equal((await store.integrationStatus(taskId)).ready, true);
  } finally {
    await db.end();
  }
});
