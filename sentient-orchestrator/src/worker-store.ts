import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  assertWorkerTransition,
  type SentientWorker,
  type SpawnWorkerRequest,
  type WorkerStatus,
} from "./worker-control.js";

export class WorkerStore {
  constructor(private readonly db: Pool) {}

  async request(x: SpawnWorkerRequest) {
    const correlationId = x.correlationId ?? randomUUID();
    const inserted = await this.db.query(
      `INSERT INTO worker_spawn_requests(
         task_id, tenant, repository_owner, repository_name, role, subtask,
         required_capabilities, preferred_model_tier, max_cost_usd, max_duration_ms,
         repository_permissions, workspace_requirement, parent_worker_id, coordinator_id,
         idempotency_key, correlation_id, max_attempts
       )
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17)
       ON CONFLICT(tenant,idempotency_key) DO NOTHING
       RETURNING id`,
      [
        x.taskId,
        x.tenant,
        x.repository.owner,
        x.repository.repo,
        x.role,
        JSON.stringify(x.assignment),
        x.requiredCapabilities ?? [],
        x.preferredModelTier ?? null,
        x.maxCostUsd ?? null,
        x.maxDurationMs ?? null,
        JSON.stringify(x.repositoryPermissions ?? {}),
        x.workspaceRequirement == null ? null : JSON.stringify(x.workspaceRequirement),
        x.parentWorkerId ?? null,
        x.coordinatorId ?? null,
        x.idempotencyKey,
        correlationId,
        x.maxAttempts ?? 3,
      ],
    );

    let id = inserted.rows[0]?.id as string | undefined;
    const created = Boolean(id);
    if (!id) {
      const existing = await this.db.query(
        `SELECT id FROM worker_spawn_requests WHERE tenant=$1 AND idempotency_key=$2`,
        [x.tenant, x.idempotencyKey],
      );
      id = existing.rows[0].id as string;
    }

    if (created) {
      for (const dependency of x.dependencies ?? []) {
        await this.db.query(
          `INSERT INTO worker_dependencies(spawn_request_id,depends_on_worker_id)
           VALUES($1,$2) ON CONFLICT DO NOTHING`,
          [id, dependency],
        );
      }
      await this.event(x.taskId, "WORKER_SPAWN_REQUESTED", null, { spawnRequestId: id });
    }
    return { id, created };
  }

  async claim(owner: string, ms = 30_000) {
    const result = await this.db.query(
      `WITH candidate AS (
         SELECT id
         FROM worker_spawn_requests
         WHERE next_attempt_at <= now()
           AND (
             status = 'pending'
             OR (status = 'claimed' AND claim_expires_at <= now())
             OR status = 'blocked'
           )
         ORDER BY next_attempt_at, created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE worker_spawn_requests
       SET status='claimed',
           claim_owner=$1,
           claim_expires_at=now()+$2*interval '1 millisecond',
           updated_at=now()
       WHERE id=(SELECT id FROM candidate)
       RETURNING *`,
      [owner, ms],
    );
    return result.rows[0] ?? null;
  }

  async dependencies(id: string) {
    return (
      await this.db.query(
        `SELECT w.id,w.status
         FROM worker_dependencies d
         JOIN sentient_workers w ON w.id=d.depends_on_worker_id
         WHERE d.spawn_request_id=$1`,
        [id],
      )
    ).rows;
  }

  async block(id: string, reason: string, recheckMs = 1_000) {
    await this.db.query(
      `UPDATE worker_spawn_requests
       SET status='blocked',
           claim_owner=NULL,
           claim_expires_at=NULL,
           last_error=$2,
           next_attempt_at=now()+$3*interval '1 millisecond',
           updated_at=now()
       WHERE id=$1`,
      [id, reason, recheckMs],
    );
  }

  async reject(id: string, reason: string) {
    const result = await this.db.query(
      `UPDATE worker_spawn_requests
       SET status='failed',last_error=$2,claim_owner=NULL,claim_expires_at=NULL,updated_at=now()
       WHERE id=$1 RETURNING task_id`,
      [id, reason],
    );
    if (result.rowCount) {
      await this.event(result.rows[0].task_id, "WORKER_FAILED", null, { reason });
    }
  }

  async create(q: any, runtime: string, owner: string, lease = 60_000) {
    const nextAttempt = Number(q.attempt_count) + 1;
    const result = await this.db.query(
      `INSERT INTO sentient_workers(
         spawn_request_id,task_id,tenant,repository_owner,repository_name,role,assignment,status,
         runtime_id,model_provider_requirements,capabilities,authority,workspace_assignment,budget_usd,
         lease_owner,lease_expires_at,parent_worker_id,coordinator_id,correlation_id,attempt_count
       )
       SELECT id,task_id,tenant,repository_owner,repository_name,role,subtask,'assigned',
              $2,jsonb_build_object('preferredModelTier',preferred_model_tier),required_capabilities,
              repository_permissions,workspace_requirement,max_cost_usd,$3,
              now()+$4*interval '1 millisecond',parent_worker_id,coordinator_id,correlation_id,$5
       FROM worker_spawn_requests
       WHERE id=$1
       ON CONFLICT(spawn_request_id,attempt_count)
       DO UPDATE SET spawn_request_id=EXCLUDED.spawn_request_id
       RETURNING *`,
      [q.id, runtime, owner, lease, nextAttempt],
    );
    const worker = map(result.rows[0]);
    await this.db.query(
      `UPDATE worker_spawn_requests
       SET status='scheduled',
           attempt_count=greatest(attempt_count,$2),
           claim_owner=NULL,
           claim_expires_at=NULL,
           updated_at=now()
       WHERE id=$1`,
      [q.id, worker.attemptCount],
    );
    await this.event(worker.taskId, "WORKER_ASSIGNED", worker.id, {
      runtime,
      attempt: worker.attemptCount,
    });
    return worker;
  }

  async transition(id: string, to: WorkerStatus, reason?: string) {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query(
        `SELECT * FROM sentient_workers WHERE id=$1 FOR UPDATE`,
        [id],
      );
      if (!current.rowCount) throw new Error("Unknown worker");
      assertWorkerTransition(current.rows[0].status, to);
      const terminal = ["completed", "failed", "cancelled", "expired"].includes(to);
      const result = await client.query(
        `UPDATE sentient_workers
         SET status=$2,
             started_at=CASE WHEN $2='running' THEN coalesce(started_at,now()) ELSE started_at END,
             completed_at=CASE WHEN $3 THEN now() ELSE completed_at END,
             failure_reason=CASE WHEN $2='failed' THEN $4 ELSE failure_reason END,
             termination_reason=CASE WHEN $2 IN('cancelled','expired') THEN $4 ELSE termination_reason END,
             lease_owner=CASE WHEN $3 THEN NULL ELSE lease_owner END,
             lease_expires_at=CASE WHEN $3 THEN NULL ELSE lease_expires_at END
         WHERE id=$1 RETURNING *`,
        [id, to, terminal, reason ?? null],
      );
      await client.query("COMMIT");
      const worker = map(result.rows[0]);
      await this.event(worker.taskId, `WORKER_${to.toUpperCase()}`, worker.id, { reason });
      return worker;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async handle(id: string, handle: string) {
    await this.db.query(`UPDATE sentient_workers SET runtime_handle=$2 WHERE id=$1`, [id, handle]);
    return this.transition(id, "starting");
  }

  async heartbeat(id: string, owner: string, ms = 60_000, spent?: number) {
    const result = await this.db.query(
      `UPDATE sentient_workers
       SET last_heartbeat_at=now(),
           lease_expires_at=now()+$3*interval '1 millisecond',
           spent_usd=greatest(spent_usd,coalesce($4,spent_usd))
       WHERE id=$1 AND lease_owner=$2 AND status IN('starting','running','blocked','waiting')
       RETURNING task_id`,
      [id, owner, ms, spent ?? null],
    );
    if (result.rowCount) {
      await this.event(result.rows[0].task_id, "WORKER_HEARTBEAT", id, {});
    }
    return Boolean(result.rowCount);
  }

  async stale() {
    return (
      await this.db.query(
        `SELECT * FROM sentient_workers
         WHERE status IN('starting','running','blocked','waiting')
           AND lease_expires_at<=now()`,
      )
    ).rows.map(map);
  }

  async get(id: string) {
    const result = await this.db.query(`SELECT * FROM sentient_workers WHERE id=$1`, [id]);
    if (!result.rowCount) throw new Error("Unknown worker");
    return map(result.rows[0]);
  }

  async task(id: string) {
    return (
      await this.db.query(
        `SELECT * FROM sentient_workers WHERE task_id=$1 ORDER BY created_at,attempt_count`,
        [id],
      )
    ).rows.map(map);
  }

  async retry(worker: SentientWorker, reason: string) {
    const result = await this.db.query(
      `UPDATE worker_spawn_requests
       SET status=CASE WHEN attempt_count<max_attempts THEN 'pending' ELSE 'failed' END,
           next_attempt_at=now()+interval '1 second',
           claim_owner=NULL,
           claim_expires_at=NULL,
           last_error=$2,
           updated_at=now()
       WHERE id=$1
       RETURNING status`,
      [worker.spawnRequestId, reason],
    );
    const retrying = result.rows[0]?.status === "pending";
    await this.event(
      worker.taskId,
      retrying ? "WORKER_RETRY_SCHEDULED" : "WORKER_FAILED",
      worker.id,
      { reason, priorAttempt: worker.attemptCount },
    );
    return retrying;
  }

  async event(task: string, type: string, worker: string | null, details: unknown) {
    await this.db.query(
      `INSERT INTO audit_events(task_id,event_type,actor,details)
       VALUES($1,$2,$3,$4::jsonb)`,
      [task, type, worker ? `worker:${worker}` : "worker-control-plane", JSON.stringify(details ?? {})],
    );
  }
}

function map(row: any): SentientWorker {
  return {
    id: row.id,
    spawnRequestId: row.spawn_request_id,
    taskId: row.task_id,
    tenant: row.tenant,
    role: row.role,
    assignment: row.assignment,
    status: row.status,
    runtimeId: row.runtime_id ?? undefined,
    runtimeHandle: row.runtime_handle ?? undefined,
    leaseOwner: row.lease_owner ?? undefined,
    leaseExpiresAt: row.lease_expires_at?.toISOString() ?? undefined,
    lastHeartbeatAt: row.last_heartbeat_at?.toISOString() ?? undefined,
    attemptCount: Number(row.attempt_count),
    budgetUsd: row.budget_usd == null ? undefined : Number(row.budget_usd),
    spentUsd: Number(row.spent_usd),
    parentWorkerId: row.parent_worker_id ?? undefined,
    correlationId: row.correlation_id,
  };
}
