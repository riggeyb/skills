import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { SentientWorker } from "../src/worker-control.js";

const repository = { owner: "riggeyb", repo: "skills" };

export async function createTask(db: Pool): Promise<string> {
  const deliveryId = randomUUID();
  const result = await db.query(
    `INSERT INTO tasks(delivery_id,objective,status,origin)
     VALUES($1,'coordination activation acceptance test','running',$2::jsonb)
     RETURNING id`,
    [deliveryId, JSON.stringify({
      repository,
      installationId: 1,
      deliveryId,
      requestedBy: "coordination-activation-acceptance-test",
    })],
  );
  return result.rows[0].id;
}

export async function createWorker(db: Pool, taskId: string, role: string): Promise<SentientWorker> {
  const tenant = `coord-activation-acceptance:${taskId}`;
  const correlationId = `coord-activation-acceptance:${randomUUID()}`;
  const assignment = { objective: `${role} coordination`, assignmentId: `phase:${role}` };
  const spawn = await db.query(
    `INSERT INTO worker_spawn_requests(
       task_id,tenant,repository_owner,repository_name,role,subtask,required_capabilities,
       max_cost_usd,idempotency_key,correlation_id,status
     )
     VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,1,$8,$9,'scheduled')
     RETURNING id`,
    [
      taskId, tenant, repository.owner, repository.repo, role, JSON.stringify(assignment),
      ["coord-activation-test"], randomUUID(), correlationId,
    ],
  );
  const spawnRequestId = spawn.rows[0].id;
  const row = await db.query(
    `INSERT INTO sentient_workers(
       spawn_request_id,task_id,tenant,repository_owner,repository_name,role,assignment,status,
       runtime_id,capabilities,authority,budget_usd,attempt_count,correlation_id
     )
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,'waiting','model-backed',$8,'{}'::jsonb,1,1,$9)
     RETURNING id`,
    [
      spawnRequestId, taskId, tenant, repository.owner, repository.repo, role, JSON.stringify(assignment),
      ["coord-activation-test"], correlationId,
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
    status: "waiting",
    runtimeId: "model-backed",
    attemptCount: 1,
    budgetUsd: 1,
    spentUsd: 0,
    correlationId,
    capabilities: ["coord-activation-test"],
    authority: {},
    modelProviderRequirements: {},
  };
}

export function actor(worker: SentientWorker) {
  return {
    workerId: worker.id,
    taskId: worker.taskId,
    tenant: worker.tenant,
    repository: worker.repository!,
    attemptCount: worker.attemptCount,
  };
}

export async function workerCount(db: Pool, taskId: string): Promise<number> {
  const result = await db.query(
    `SELECT count(*)::int AS n FROM sentient_workers WHERE task_id=$1`,
    [taskId],
  );
  return Number(result.rows[0].n);
}

export async function executionCount(db: Pool, workerId: string): Promise<number> {
  const result = await db.query(
    `SELECT count(*)::int AS n
     FROM worker_coordination_runtime_executions
     WHERE worker_id=$1`,
    [workerId],
  );
  return Number(result.rows[0].n);
}

export async function deliveryState(db: Pool, messageId: string, workerId: string) {
  const result = await db.query(
    `SELECT state,delivery_attempts
     FROM sentient_coordination_deliveries
     WHERE message_id=$1 AND recipient_worker_id=$2`,
    [messageId, workerId],
  );
  assert.equal(result.rowCount, 1);
  return result.rows[0];
}

export async function activationState(db: Pool, messageId: string, workerId: string) {
  const result = await db.query(
    `SELECT state,activation_attempts,max_activation_attempts,last_error
     FROM sentient_coordination_activations
     WHERE message_id=$1 AND recipient_worker_id=$2`,
    [messageId, workerId],
  );
  assert.equal(result.rowCount, 1);
  return result.rows[0];
}

export async function waitForExecutionTerminal(
  db: Pool,
  messageId: string,
  workerId: string,
  attempt: number,
): Promise<void> {
  for (let index = 0; index < 300; index++) {
    const result = await db.query(
      `SELECT e.status
       FROM worker_coordination_runtime_executions e
       JOIN sentient_coordination_activations a ON a.activation_id=e.activation_id
       WHERE a.message_id=$1 AND e.worker_id=$2 AND e.execution_attempt=$3`,
      [messageId, workerId, attempt],
    );
    if (result.rows[0] && ["completed", "failed", "cancelled"].includes(result.rows[0].status)) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`coordination execution attempt ${attempt} did not reach terminal state`);
}
