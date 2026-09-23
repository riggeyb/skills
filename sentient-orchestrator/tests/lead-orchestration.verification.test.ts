import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { LeadOrchestrationError, LeadOrchestrationStore } from "../src/lead-orchestration.js";
import {
  AUTHORITIES,
  LEAD_AUTHORITY_BY_MESSAGE,
  ProtocolValidationError,
  assertAuthority,
  validateMessage,
  validateWorkerContract,
} from "../src/worker-protocol.js";

const url = process.env.DATABASE_URL;

async function task(db: Pool, objective: string) {
  const deliveryId = randomUUID();
  return (
    await db.query(
      `INSERT INTO tasks(delivery_id,objective,status,origin)
       VALUES($1,$2,'running','{}'::jsonb)
       RETURNING id`,
      [deliveryId, objective],
    )
  ).rows[0].id as string;
}

async function spawn(db: Pool, taskId: string) {
  return (
    await db.query(
      `INSERT INTO worker_spawn_requests(
         task_id,tenant,repository_owner,repository_name,role,subtask,
         idempotency_key,correlation_id,status
       )
       VALUES($1,'tenant-a','riggeyb','skills','specialist','{}'::jsonb,$2,$3,'scheduled')
       RETURNING id`,
      [taskId, randomUUID(), randomUUID()],
    )
  ).rows[0].id as string;
}

async function worker(db: Pool, taskId: string, role: "lead" | "specialist") {
  const spawnRequestId = await spawn(db, taskId);
  return (
    await db.query(
      `INSERT INTO sentient_workers(
         spawn_request_id,task_id,tenant,repository_owner,repository_name,role,
         assignment,status,correlation_id
       )
       VALUES($1,$2,'tenant-a','riggeyb','skills',$3,'{}'::jsonb,'running',$4)
       RETURNING id`,
      [spawnRequestId, taskId, role, randomUUID()],
    )
  ).rows[0].id as string;
}

const leadError = (code: string) => (error: unknown) =>
  error instanceof LeadOrchestrationError && error.code === code;

test("race/takeover increments epoch and fences stale assign/direct/review/readiness", { skip: !url }, async () => {
  const db = new Pool({ connectionString: url! });
  try {
    const taskId = await task(db, "race");
    const leadA = await worker(db, taskId, "lead");
    const leadB = await worker(db, taskId, "lead");
    const specialist = await worker(db, taskId, "specialist");
    const store = new LeadOrchestrationStore(db);

    const race = await Promise.allSettled([
      store.acquireLeadership(taskId, leadA, 60_000),
      store.acquireLeadership(taskId, leadB, 60_000),
    ]);
    assert.equal(race.filter(result => result.status === "fulfilled").length, 1);

    const winner = race.find(result => result.status === "fulfilled");
    assert.ok(winner && winner.status === "fulfilled");
    const oldLead = winner.value.leadWorkerId;
    const newLead = oldLead === leadA ? leadB : leadA;
    const oldEpoch = winner.value.epoch;

    await db.query(
      `UPDATE task_leadership
       SET lease_expires_at=now()-interval '1 second'
       WHERE task_id=$1`,
      [taskId],
    );
    const takeover = await store.acquireLeadership(taskId, newLead, 60_000);
    assert.equal(takeover.epoch, oldEpoch + 1);

    await assert.rejects(
      store.assign({
        taskId,
        leadWorkerId: oldLead,
        epoch: oldEpoch,
        externalId: "stale",
        idempotencyKey: randomUUID(),
        targetWorkerId: specialist,
        objective: "x",
        assignment: {},
        acceptanceCriteria: [],
        dependencies: [],
        required: true,
      }),
      leadError("STALE_LEAD"),
    );
    await assert.rejects(
      store.directive({
        taskId,
        leadWorkerId: oldLead,
        epoch: oldEpoch,
        externalId: "directive-stale",
        idempotencyKey: randomUUID(),
        directiveType: "redirect",
        payload: {},
      }),
      leadError("STALE_LEAD"),
    );

    await store.assign({
      taskId,
      leadWorkerId: newLead,
      epoch: takeover.epoch,
      externalId: "a1",
      idempotencyKey: randomUUID(),
      targetWorkerId: specialist,
      objective: "x",
      assignment: {},
      acceptanceCriteria: [],
      dependencies: [],
      required: true,
    });
    await store.submitHandoff(taskId, "a1", specialist, { handoffId: "h1", v: 1 });

    await assert.rejects(
      store.review({
        taskId,
        leadWorkerId: oldLead,
        epoch: oldEpoch,
        assignmentId: "a1",
        handoffId: "h1",
        decision: "accepted",
      }),
      leadError("STALE_LEAD"),
    );
    await assert.rejects(
      store.markIntegrationReady(taskId, oldLead, oldEpoch),
      leadError("STALE_LEAD"),
    );
  } finally {
    await db.end();
  }
});

test("pending/blocked/handoff/rework gate readiness and rework history survives", { skip: !url }, async () => {
  const db = new Pool({ connectionString: url! });
  try {
    const taskId = await task(db, "gate");
    const leadId = await worker(db, taskId, "lead");
    const specialist = await worker(db, taskId, "specialist");
    const store = new LeadOrchestrationStore(db);
    const leadership = await store.acquireLeadership(taskId, leadId, 60_000);

    await store.assign({
      taskId,
      leadWorkerId: leadId,
      epoch: leadership.epoch,
      externalId: "req",
      idempotencyKey: randomUUID(),
      targetWorkerId: specialist,
      objective: "x",
      assignment: {},
      acceptanceCriteria: [],
      dependencies: [],
      required: true,
    });
    assert.equal((await store.integrationStatus(taskId)).ready, false);

    await db.query(`UPDATE worker_assignments SET status='blocked' WHERE task_id=$1`, [taskId]);
    assert.deepEqual((await store.integrationStatus(taskId)).blockers, ["req:blocked"]);

    await db.query(`UPDATE worker_assignments SET status='in_progress' WHERE task_id=$1`, [taskId]);
    await store.submitHandoff(taskId, "req", specialist, { handoffId: "h1", v: 1 });
    assert.deepEqual((await store.integrationStatus(taskId)).blockers, ["req:handed_off"]);

    await store.review({
      taskId,
      leadWorkerId: leadId,
      epoch: leadership.epoch,
      assignmentId: "req",
      handoffId: "h1",
      decision: "rework",
    });
    assert.deepEqual((await store.integrationStatus(taskId)).blockers, ["req:rework"]);

    const events = (
      await db.query(
        `SELECT event_type,payload
         FROM lead_assignment_events
         WHERE task_id=$1`,
        [taskId],
      )
    ).rows;
    assert.ok(events.some(event => event.event_type === "HANDOFF_SUBMITTED" && event.payload.handoff?.v === 1));
    assert.ok(events.some(event => event.event_type === "REWORK_REQUIRED" && event.payload.handoffId === "h1"));

    await store.submitHandoff(taskId, "req", specialist, { handoffId: "h2", v: 2 });
    await store.review({
      taskId,
      leadWorkerId: leadId,
      epoch: leadership.epoch,
      assignmentId: "req",
      handoffId: "h2",
      decision: "accepted",
    });
    assert.equal((await store.integrationStatus(taskId)).ready, true);

    await db.query(
      `UPDATE task_leadership
       SET lease_expires_at=now()-interval '1 second'
       WHERE task_id=$1`,
      [taskId],
    );
    assert.equal((await store.integrationStatus(taskId)).ready, false);
  } finally {
    await db.end();
  }
});

test("cross-task spawn target is rejected", { skip: !url }, async () => {
  const db = new Pool({ connectionString: url! });
  try {
    const taskA = await task(db, "a");
    const taskB = await task(db, "b");
    const leadId = await worker(db, taskA, "lead");
    const foreignSpawn = await spawn(db, taskB);
    const store = new LeadOrchestrationStore(db);
    const leadership = await store.acquireLeadership(taskA, leadId, 60_000);

    await assert.rejects(
      store.assign({
        taskId: taskA,
        leadWorkerId: leadId,
        epoch: leadership.epoch,
        externalId: "x",
        idempotencyKey: randomUUID(),
        spawnRequestId: foreignSpawn,
        objective: "x",
        assignment: {},
        acceptanceCriteria: [],
        dependencies: [],
        required: true,
      }),
      error => error instanceof LeadOrchestrationError,
    );

    assert.equal(
      (
        await db.query(
          `SELECT count(*)::int n
           FROM worker_assignments
           WHERE task_id=$1 AND external_id='x'`,
          [taskA],
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await db.end();
  }
});

test("schema/runtime Lead authorities match; authoritative messages require positive epoch", () => {
  const schema = JSON.parse(
    readFileSync(
      new URL("../schemas/sentient-worker-contract.v1.schema.json", import.meta.url),
      "utf8",
    ),
  );
  const schemaAuthorities = schema.properties.authority.items.enum as string[];
  assert.deepEqual(new Set(schemaAuthorities), new Set(AUTHORITIES));
  for (const authority of Object.values(LEAD_AUTHORITY_BY_MESSAGE)) {
    if (authority) assert.ok(schemaAuthorities.includes(authority));
  }

  const contract = validateWorkerContract({
    protocolVersion: "1.0",
    workerId: "lead",
    taskId: "task",
    tenantId: "tenant-a",
    repositoryId: "riggeyb/skills",
    role: "lead",
    objective: "x",
    assignment: "x",
    constraints: [],
    dependencies: [],
    capabilities: [],
    authority: [...AUTHORITIES],
    resourceClaims: [],
    budget: {},
    allowedTools: [],
    modelRuntimeRequirements: {},
    completionCriteria: [],
    reportingRequirements: [],
  });
  const message = {
    protocolVersion: "1.0",
    messageId: "message",
    type: "ASSIGNMENT",
    taskId: "task",
    senderWorkerId: "lead",
    correlationId: "correlation",
    repositoryId: "riggeyb/skills",
    tenantId: "tenant-a",
    createdAt: "2026-09-23T19:00:00Z",
    payload: {
      leadershipEpoch: 1,
      assignmentId: "assignment",
      idempotencyKey: "key",
      targetWorkerId: "worker",
      objective: "x",
      assignment: {},
      acceptanceCriteria: [],
      dependencies: [],
      required: true,
    },
  };

  assert.equal(validateMessage(message, { contract }).type, "ASSIGNMENT");
  for (const [field, code] of [
    ["taskId", "CROSS_TASK"],
    ["tenantId", "CROSS_TENANT"],
    ["repositoryId", "CROSS_REPOSITORY"],
  ] as const) {
    assert.throws(
      () => validateMessage({ ...message, [field]: "other" }, { contract }),
      error => error instanceof ProtocolValidationError && error.code === code,
    );
  }
  assert.throws(
    () =>
      validateMessage(
        { ...message, payload: { ...message.payload, leadershipEpoch: 0 } },
        { contract },
      ),
    error => error instanceof ProtocolValidationError && error.code === "MALFORMED",
  );
  assert.throws(
    () =>
      assertAuthority(
        { ...contract, role: "specialist", authority: ["repository:read"] },
        "workers:assign",
      ),
    error => error instanceof ProtocolValidationError && error.code === "AUTHORITY_VIOLATION",
  );
});
