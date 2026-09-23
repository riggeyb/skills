import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { LeadOrchestrationError, LeadOrchestrationStore } from "../src/lead-orchestration.js";

const url = process.env.DATABASE_URL;

async function seedTask(db: Pool) {
  const delivery = randomUUID();
  return (await db.query(
    `INSERT INTO tasks(delivery_id,objective,status,origin)
     VALUES($1,'required cancellation gate','running','{}'::jsonb)
     RETURNING id`,
    [delivery],
  )).rows[0].id as string;
}

async function seedWorker(db: Pool, taskId: string, role: "lead" | "specialist") {
  const request = (await db.query(
    `INSERT INTO worker_spawn_requests(
       task_id,tenant,repository_owner,repository_name,role,subtask,idempotency_key,correlation_id
     ) VALUES($1,'tenant-a','riggeyb','skills',$2,'{}'::jsonb,$3,$4)
     RETURNING id`,
    [taskId, role, randomUUID(), randomUUID()],
  )).rows[0].id as string;

  return (await db.query(
    `INSERT INTO sentient_workers(
       spawn_request_id,task_id,tenant,repository_owner,repository_name,role,assignment,status,correlation_id
     ) VALUES($1,$2,'tenant-a','riggeyb','skills',$3,'{}'::jsonb,'running',$4)
     RETURNING id`,
    [request, taskId, role, randomUUID()],
  )).rows[0].id as string;
}

test("required cancelled work remains blocking until explicitly made non-required", { skip: !url }, async () => {
  const db = new Pool({ connectionString: url! });
  try {
    const taskId = await seedTask(db);
    const leadId = await seedWorker(db, taskId, "lead");
    const specialistId = await seedWorker(db, taskId, "specialist");
    const store = new LeadOrchestrationStore(db);
    const leadership = await store.acquireLeadership(taskId, leadId, 60_000);

    await store.assign({
      taskId,
      leadWorkerId: leadId,
      epoch: leadership.epoch,
      externalId: "required-cancelled",
      idempotencyKey: randomUUID(),
      targetWorkerId: specialistId,
      objective: "required work",
      assignment: {},
      acceptanceCriteria: [],
      dependencies: [],
      required: true,
    });

    await db.query(
      `UPDATE worker_assignments
       SET status='cancelled'
       WHERE task_id=$1 AND external_id='required-cancelled'`,
      [taskId],
    );

    const stillRequired = await store.integrationStatus(taskId);
    assert.equal(stillRequired.ready, false);
    assert.ok(stillRequired.pendingAssignments.includes("required-cancelled"));
    await assert.rejects(
      store.markIntegrationReady(taskId, leadId, leadership.epoch),
      (error: unknown) => error instanceof LeadOrchestrationError && error.code === "NOT_READY",
    );

    await db.query(
      `UPDATE worker_assignments
       SET required=false
       WHERE task_id=$1 AND external_id='required-cancelled'`,
      [taskId],
    );
    assert.equal((await store.integrationStatus(taskId)).ready, true);
  } finally {
    await db.end();
  }
});
