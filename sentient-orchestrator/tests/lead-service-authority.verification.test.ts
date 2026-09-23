import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  LeadOrchestrationError,
  LeadOrchestrationStore,
  LeadSentientService,
} from "../src/lead-orchestration.js";
import { AUTHORITIES } from "../src/worker-protocol.js";

const url = process.env.DATABASE_URL;

async function seedTask(db: Pool, objective: string) {
  const delivery = randomUUID();
  return (await db.query(
    `INSERT INTO tasks(delivery_id,objective,status,origin)
     VALUES($1,$2,'running','{}'::jsonb) RETURNING id`,
    [delivery, objective],
  )).rows[0].id as string;
}

async function seedWorker(db: Pool, taskId: string, role: "lead" | "specialist") {
  const requestId = (await db.query(
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
    [requestId, taskId, role, randomUUID()],
  )).rows[0].id as string;
}

function contract(workerId: string, taskId: string, role: "lead" | "specialist", overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: "1.0",
    workerId,
    taskId,
    tenantId: "tenant-a",
    repositoryId: "riggeyb/skills",
    role,
    objective: "coordinate",
    assignment: "bounded",
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
    ...overrides,
  };
}

function assignmentMessage(
  workerId: string,
  taskId: string,
  epoch: number,
  targetWorkerId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    protocolVersion: "1.0",
    messageId: randomUUID(),
    type: "ASSIGNMENT",
    taskId,
    senderWorkerId: workerId,
    correlationId: randomUUID(),
    repositoryId: "riggeyb/skills",
    tenantId: "tenant-a",
    createdAt: new Date().toISOString(),
    payload: {
      leadershipEpoch: epoch,
      assignmentId: randomUUID(),
      idempotencyKey: randomUUID(),
      targetWorkerId,
      objective: "bounded work",
      assignment: {},
      acceptanceCriteria: [],
      dependencies: [],
      required: true,
    },
    ...overrides,
  };
}

const rejectsCode = (code: string) => (error: unknown) =>
  error instanceof LeadOrchestrationError && error.code === code;

test("protocol-valid commands still require durable leadership; specialist and forged bindings cannot mutate", { skip: !url }, async () => {
  const db = new Pool({ connectionString: url! });
  try {
    const taskId = await seedTask(db, "service authority");
    const leadId = await seedWorker(db, taskId, "lead");
    const specialistId = await seedWorker(db, taskId, "specialist");
    const store = new LeadOrchestrationStore(db);
    const service = new LeadSentientService(store);
    const leadContract = contract(leadId, taskId, "lead");

    // Shape-valid + capability-valid is insufficient without an active durable leadership lease.
    await assert.rejects(
      service.admitLeadMessage(leadContract, assignmentMessage(leadId, taskId, 1, specialistId)),
      rejectsCode("STALE_LEAD"),
    );

    // Role is independently enforced even if a specialist is handed all lead capabilities.
    const specialistContract = contract(specialistId, taskId, "specialist");
    await assert.rejects(
      service.admitLeadMessage(
        specialistContract,
        assignmentMessage(specialistId, taskId, 1, specialistId),
      ),
      rejectsCode("INVALID_LEAD"),
    );

    const leadership = await service.acquireLead(leadContract, 60_000);

    // A forged contract+message pair can be internally protocol-consistent, but durable worker binding wins.
    const crossTask = randomUUID();
    await assert.rejects(
      service.admitLeadMessage(
        contract(leadId, crossTask, "lead"),
        assignmentMessage(leadId, crossTask, leadership.epoch, specialistId),
      ),
      rejectsCode("CROSS_TASK"),
    );
    await assert.rejects(
      service.admitLeadMessage(
        contract(leadId, taskId, "lead", { tenantId: "tenant-b" }),
        assignmentMessage(leadId, taskId, leadership.epoch, specialistId, { tenantId: "tenant-b" }),
      ),
      rejectsCode("CROSS_TENANT"),
    );
    await assert.rejects(
      service.admitLeadMessage(
        contract(leadId, taskId, "lead", { repositoryId: "other/repo" }),
        assignmentMessage(leadId, taskId, leadership.epoch, specialistId, { repositoryId: "other/repo" }),
      ),
      rejectsCode("CROSS_REPOSITORY"),
    );

    assert.equal(
      (await db.query(`SELECT count(*)::int n FROM worker_assignments WHERE task_id=$1`, [taskId])).rows[0].n,
      0,
    );

    await service.admitLeadMessage(
      leadContract,
      assignmentMessage(leadId, taskId, leadership.epoch, specialistId),
    );
    assert.equal(
      (await db.query(`SELECT count(*)::int n FROM worker_assignments WHERE task_id=$1`, [taskId])).rows[0].n,
      1,
    );
  } finally {
    await db.end();
  }
});
