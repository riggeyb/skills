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

async function task(db: Pool) {
  return (await db.query(
    `INSERT INTO tasks(delivery_id,objective,status,origin)
     VALUES($1,'durable lead authority','running','{}'::jsonb) RETURNING id`,
    [randomUUID()],
  )).rows[0].id as string;
}

async function worker(db: Pool, taskId: string, role: "lead" | "specialist") {
  const requestId = (await db.query(
    `INSERT INTO worker_spawn_requests(
       task_id,tenant,repository_owner,repository_name,role,subtask,idempotency_key,correlation_id,status
     ) VALUES($1,'tenant-a','riggeyb','skills',$2,'{}'::jsonb,$3,$4,'scheduled') RETURNING id`,
    [taskId, role, randomUUID(), randomUUID()],
  )).rows[0].id as string;
  return (await db.query(
    `INSERT INTO sentient_workers(
       spawn_request_id,task_id,tenant,repository_owner,repository_name,role,assignment,status,correlation_id
     ) VALUES($1,$2,'tenant-a','riggeyb','skills',$3,'{}'::jsonb,'running',$4) RETURNING id`,
    [requestId, taskId, role, randomUUID()],
  )).rows[0].id as string;
}

function contract(workerId: string, taskId: string, role: "lead" | "specialist", overrides = {}) {
  return {
    protocolVersion: "1.0", workerId, taskId, tenantId: "tenant-a", repositoryId: "riggeyb/skills",
    role, objective: "coordinate", assignment: "bounded", constraints: [], dependencies: [], capabilities: [],
    authority: [...AUTHORITIES], resourceClaims: [], budget: {}, allowedTools: [],
    modelRuntimeRequirements: {}, completionCriteria: [], reportingRequirements: [], ...overrides,
  };
}

function assignment(workerId: string, taskId: string, epoch: number, targetWorkerId: string, overrides = {}) {
  return {
    protocolVersion: "1.0", messageId: randomUUID(), type: "ASSIGNMENT", taskId,
    senderWorkerId: workerId, correlationId: randomUUID(), repositoryId: "riggeyb/skills",
    tenantId: "tenant-a", createdAt: new Date().toISOString(),
    payload: {
      leadershipEpoch: epoch, assignmentId: randomUUID(), idempotencyKey: randomUUID(),
      targetWorkerId, objective: "bounded work", assignment: {}, acceptanceCriteria: [],
      dependencies: [], required: true,
    },
    ...overrides,
  };
}

const rejects = (code: string) => (error: unknown) =>
  error instanceof LeadOrchestrationError && error.code === code;

test("protocol authority cannot bypass durable Lead identity and epoch", { skip: !url }, async () => {
  const db = new Pool({ connectionString: url! });
  try {
    const taskId = await task(db);
    const leadId = await worker(db, taskId, "lead");
    const specialistId = await worker(db, taskId, "specialist");
    const service = new LeadSentientService(new LeadOrchestrationStore(db));
    const leadContract = contract(leadId, taskId, "lead");

    await assert.rejects(
      service.admitLeadMessage(leadContract, assignment(leadId, taskId, 1, specialistId)),
      rejects("STALE_LEAD"),
    );
    await assert.rejects(
      service.admitLeadMessage(
        contract(specialistId, taskId, "specialist"),
        assignment(specialistId, taskId, 1, specialistId),
      ),
      rejects("INVALID_LEAD"),
    );

    const leadership = await service.acquireLead(leadContract, 60_000);
    await assert.rejects(
      service.admitLeadMessage(
        contract(leadId, randomUUID(), "lead"),
        assignment(leadId, randomUUID(), leadership.epoch, specialistId),
      ),
      (error: unknown) => error instanceof Error,
    );
    await assert.rejects(
      service.admitLeadMessage(
        contract(leadId, taskId, "lead", { tenantId: "tenant-b" }),
        assignment(leadId, taskId, leadership.epoch, specialistId, { tenantId: "tenant-b" }),
      ),
      rejects("CROSS_TENANT"),
    );
    await assert.rejects(
      service.admitLeadMessage(
        contract(leadId, taskId, "lead", { repositoryId: "other/repo" }),
        assignment(leadId, taskId, leadership.epoch, specialistId, { repositoryId: "other/repo" }),
      ),
      rejects("CROSS_REPOSITORY"),
    );

    assert.equal((await db.query(
      `SELECT count(*)::int n FROM worker_assignments WHERE task_id=$1`, [taskId],
    )).rows[0].n, 0);

    await service.admitLeadMessage(
      leadContract,
      assignment(leadId, taskId, leadership.epoch, specialistId),
    );
    assert.equal((await db.query(
      `SELECT count(*)::int n FROM worker_assignments WHERE task_id=$1`, [taskId],
    )).rows[0].n, 1);
  } finally {
    await db.end();
  }
});
