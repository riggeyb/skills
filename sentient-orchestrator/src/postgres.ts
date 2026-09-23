import type { Pool } from "pg";
import type { AgentRole, AgentState, Task, TaskMessage, TaskOrigin, TaskStatus } from "./types.js";
import type { EnqueueOptions, JobQueue, QueueJob, SentientJobPayload, TaskStore } from "./ports.js";

function iso(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export class PostgresTaskStore implements TaskStore {
  constructor(private readonly pool: Pool) {}

  async claimDelivery(deliveryId: string): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO github_deliveries(delivery_id) VALUES ($1)
       ON CONFLICT DO NOTHING RETURNING delivery_id`,
      [deliveryId],
    );
    return result.rowCount === 1;
  }

  async create(objective: string, origin: TaskOrigin, roles: AgentRole[]): Promise<Task> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const taskResult = await client.query(
        `INSERT INTO tasks(objective, status, origin)
         VALUES ($1, 'queued', $2::jsonb)
         RETURNING id`,
        [objective, JSON.stringify(origin)],
      );
      const taskId = taskResult.rows[0].id as string;
      for (const role of roles) {
        await client.query(
          `INSERT INTO task_agents(task_id, role, status) VALUES ($1, $2, 'queued')`,
          [taskId, role],
        );
      }
      await client.query("COMMIT");
      return await this.get(taskId);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async get(taskId: string): Promise<Task> {
    const [taskResult, agentResult, messageResult] = await Promise.all([
      this.pool.query(`SELECT * FROM tasks WHERE id = $1`, [taskId]),
      this.pool.query(`SELECT * FROM task_agents WHERE task_id = $1 ORDER BY role`, [taskId]),
      this.pool.query(
        `SELECT * FROM task_messages WHERE task_id = $1 ORDER BY created_at, id`,
        [taskId],
      ),
    ]);
    if (taskResult.rowCount !== 1) throw new Error(`Unknown task ${taskId}`);
    const row = taskResult.rows[0];

    return {
      id: row.id,
      objective: row.objective,
      status: row.status,
      origin: row.origin as TaskOrigin,
      error: row.error ?? undefined,
      createdAt: iso(row.created_at)!,
      updatedAt: iso(row.updated_at)!,
      agents: agentResult.rows.map((agent): AgentState => ({
        role: agent.role,
        status: agent.status,
        summary: agent.summary ?? undefined,
        startedAt: iso(agent.started_at),
        completedAt: iso(agent.completed_at),
      })),
      messages: messageResult.rows.map((message): TaskMessage => ({
        id: message.id,
        taskId: message.task_id,
        role: message.role,
        body: message.body,
        createdAt: iso(message.created_at)!,
      })),
    };
  }

  async updateStatus(taskId: string, status: TaskStatus, error?: string): Promise<Task> {
    const result = await this.pool.query(
      `UPDATE tasks SET status = $2, error = $3, updated_at = now()
       WHERE id = $1 RETURNING id`,
      [taskId, status, error ?? null],
    );
    if (result.rowCount !== 1) throw new Error(`Unknown task ${taskId}`);
    return this.get(taskId);
  }

  async updateAgent(taskId: string, role: AgentRole, patch: Partial<AgentState>): Promise<Task> {
    const current = await this.get(taskId);
    const existing = current.agents.find((agent) => agent.role === role);
    if (!existing) throw new Error(`Task ${taskId} has no ${role} agent`);
    const merged = { ...existing, ...patch };
    await this.pool.query(
      `UPDATE task_agents
       SET status = $3, summary = $4, started_at = $5, completed_at = $6
       WHERE task_id = $1 AND role = $2`,
      [
        taskId,
        role,
        merged.status,
        merged.summary ?? null,
        merged.startedAt ?? null,
        merged.completedAt ?? null,
      ],
    );
    await this.pool.query(`UPDATE tasks SET updated_at = now() WHERE id = $1`, [taskId]);
    return this.get(taskId);
  }

  async addMessage(taskId: string, role: AgentRole | "system", body: string): Promise<TaskMessage> {
    const result = await this.pool.query(
      `INSERT INTO task_messages(task_id, role, body)
       VALUES ($1, $2, $3)
       RETURNING id, task_id, role, body, created_at`,
      [taskId, role, body],
    );
    await this.pool.query(`UPDATE tasks SET updated_at = now() WHERE id = $1`, [taskId]);
    const row = result.rows[0];
    return {
      id: row.id,
      taskId: row.task_id,
      role: row.role,
      body: row.body,
      createdAt: iso(row.created_at)!,
    };
  }

  async messages(taskId: string): Promise<TaskMessage[]> {
    return (await this.get(taskId)).messages;
  }
}

export class PostgresJobQueue implements JobQueue {
  constructor(private readonly pool: Pool) {}

  async enqueue(payload: SentientJobPayload, options: EnqueueOptions): Promise<{ accepted: boolean; jobId: string }> {
    const inserted = await this.pool.query(
      `INSERT INTO jobs(idempotency_key, payload, priority, max_attempts)
       VALUES ($1, $2::jsonb, $3, $4)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [
        options.idempotencyKey,
        JSON.stringify(payload),
        options.priority ?? 0,
        options.maxAttempts ?? 5,
      ],
    );
    if (inserted.rowCount === 1) return { accepted: true, jobId: inserted.rows[0].id };

    const existing = await this.pool.query(`SELECT id FROM jobs WHERE idempotency_key = $1`, [
      options.idempotencyKey,
    ]);
    return { accepted: false, jobId: existing.rows[0].id };
  }

  async lease(workerId: string, leaseMs: number): Promise<QueueJob | null> {
    const result = await this.pool.query(
      `WITH candidate AS (
         SELECT id
         FROM jobs
         WHERE available_at <= now()
           AND (
             status = 'queued'
             OR (status = 'leased' AND lease_expires_at <= now())
           )
         ORDER BY priority DESC, available_at, created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE jobs
       SET status = 'leased',
           worker_id = $1,
           attempts = attempts + 1,
           lease_expires_at = now() + ($2 * interval '1 millisecond'),
           updated_at = now()
       WHERE id = (SELECT id FROM candidate)
       RETURNING id, payload, attempts, max_attempts, available_at, lease_expires_at`,
      [workerId, leaseMs],
    );
    if (result.rowCount !== 1) return null;
    return mapJob(result.rows[0]);
  }

  async complete(jobId: string, workerId: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE jobs
       SET status = 'completed', lease_expires_at = NULL, updated_at = now()
       WHERE id = $1 AND status = 'leased' AND worker_id = $2`,
      [jobId, workerId],
    );
    if (result.rowCount !== 1) throw new Error(`Job ${jobId} is not leased by ${workerId}`);
  }

  async fail(jobId: string, workerId: string, error: string): Promise<{ deadLettered: boolean; retryAt?: string }> {
    const current = await this.pool.query(
      `SELECT attempts, max_attempts FROM jobs
       WHERE id = $1 AND status = 'leased' AND worker_id = $2`,
      [jobId, workerId],
    );
    if (current.rowCount !== 1) throw new Error(`Job ${jobId} is not leased by ${workerId}`);

    const { attempts, max_attempts: maxAttempts } = current.rows[0];
    if (attempts >= maxAttempts) {
      await this.pool.query(
        `UPDATE jobs
         SET status = 'dead', last_error = $3, lease_expires_at = NULL, updated_at = now()
         WHERE id = $1 AND worker_id = $2`,
        [jobId, workerId, error],
      );
      return { deadLettered: true };
    }

    const delayMs = Math.min(60_000, 1_000 * 2 ** Math.max(0, attempts - 1));
    const retryAt = new Date(Date.now() + delayMs);
    await this.pool.query(
      `UPDATE jobs
       SET status = 'queued',
           last_error = $3,
           available_at = $4,
           lease_expires_at = NULL,
           worker_id = NULL,
           updated_at = now()
       WHERE id = $1 AND worker_id = $2`,
      [jobId, workerId, error, retryAt],
    );
    return { deadLettered: false, retryAt: retryAt.toISOString() };
  }

  async cancel(jobId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE jobs
       SET status = 'cancelled', lease_expires_at = NULL, worker_id = NULL, updated_at = now()
       WHERE id = $1 AND status IN ('queued', 'leased')
       RETURNING id`,
      [jobId],
    );
    return result.rowCount === 1;
  }
}

function mapJob(row: any): QueueJob {
  return {
    id: row.id,
    payload: row.payload as SentientJobPayload,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    availableAt: iso(row.available_at)!,
    leaseExpiresAt: iso(row.lease_expires_at),
  };
}
