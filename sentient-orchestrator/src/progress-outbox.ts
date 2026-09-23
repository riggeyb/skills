import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { ProgressEvent, ProgressSink } from "./types.js";
import { SecretRedactor } from "./redaction.js";

export type ProgressDestination = "issue_comment" | "discussion_comment";

export interface ProgressDelivery {
  id: string;
  taskId: string;
  installationId: number;
  repository: { owner: string; repo: string };
  issueNumber?: number;
  destination: ProgressDestination;
  destinationRef?: string;
  body: string;
  attempts: number;
  maxAttempts: number;
  leaseExpiresAt?: string;
}

export class PostgresProgressOutbox {
  constructor(private readonly pool: Pool) {}

  async enqueue(input: {
    eventKey: string;
    taskId: string;
    installationId: number;
    repository: { owner: string; repo: string };
    issueNumber?: number;
    destination: ProgressDestination;
    destinationRef?: string;
    body: string;
    maxAttempts?: number;
  }): Promise<{ accepted: boolean; id: string }> {
    const inserted = await this.pool.query(
      `INSERT INTO progress_outbox(
         event_key, task_id, installation_id, repository_owner, repository_name,
         issue_number, destination, destination_ref, payload, max_attempts
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
       ON CONFLICT (event_key) DO NOTHING
       RETURNING id`,
      [
        input.eventKey,
        input.taskId,
        input.installationId,
        input.repository.owner,
        input.repository.repo,
        input.issueNumber?? null,
        input.destination,
        input.destinationRef ?? null,
        JSON.stringify({ body: input.body }),
        input.maxAttempts ?? 8,
      ],
    );
    if (inserted.rowCount === 1) {
      return { accepted: true, id: inserted.rows[0].id as string };
    }

    const existing = await this.pool.query(
      `SELECT id FROM progress_outbox WHERE event_key = $1`,
      [input.eventKey],
    );
    if (existing.rowCount !== 1) throw new Error(`Unable to resolve progress event ${input.eventKey}`);
    return { accepted: false, id: existing.rows[0].id as string };
  }

  async lease(workerId: string, leaseMs: number): Promise<ProgressDelivery | null> {
    if (!workerId.trim()) throw new Error("workerId is required");
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000) throw new Error("leaseMs must be >= 1000");

    const result = await this.pool.query(
      `WITH candidate AS (
         SELECT id
         FROM progress_outbox
         WHERE available_at <= now()
           AND (
             status = 'queued'
             OR (status = 'leased' AND lease_expires_at <= now())
           )
         ORDER BY available_at, created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE progress_outbox
       SET status = 'leased',
           worker_id = $1,
           attempts = attempts + 1,
           lease_expires_at = now() + ($2 * interval '1 millisecond'),
           updated_at = now()
       WHERE id = (SELECT id FROM candidate)
       RETURNING *`,
      [workerId, leaseMs],
    );
    if (result.rowCount !== 1) return null;
    return mapDelivery(result.rows[0]);
  }

  async complete(id: string, workerId: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE progress_outbox
       SET status = 'delivered',
           delivered_at = now(),
           lease_expires_at = NULL,
           worker_id = NULL,
           updated_at = now()
       WHERE id = $1 AND status = 'leased' AND worker_id = $2`,
      [id, workerId],
    );
    if (result.rowCount !== 1) throw new Error(`Progress delivery ${id} is not leased by ${workerId}`);
  }

  async fail(
    id: string,
    workerId: string,
    error: string,
    retryAt?: Date,
  ): Promise<{ deadLettered: boolean; retryAt?: string }> {
    const current = await this.pool.query(
      `SELECT attempts, max_attempts
       FROM progress_outbox
       WHERE id = $1 AND status = 'leased' AND worker_id = $2`,
      [id, workerId],
    );
    if (current.rowCount !== 1) throw new Error(`Progress delivery ${id} is not leased by ${workerId}`);

    const attempts = Number(current.rows[0].attempts);
    const maxAttempts = Number(current.rows[0].max_attempts);
    if (attempts >= maxAttempts) {
      await this.pool.query(
        `UPDATE progress_outbox
         SET status = 'dead',
             last_error = $3,
             lease_expires_at = NULL,
             worker_id = NULL,
             updated_at = now()
         WHERE id = $1 AND worker_id = $2`,
        [id, workerId, error.slice(0, 8_000)],
      );
      return { deadLettered: true };
    }

    const fallbackDelayMs = Math.min(10 * 60_000, 2_000 * 2 ** Math.max(0, attempts - 1));
    const nextAttempt =
      retryAt && retryAt.getTime() > Date.now()
        ? retryAt
        : new Date(Date.now() + fallbackDelayMs);

    await this.pool.query(
      `UPDATE progress_outbox
       SET status = 'queued',
           last_error = $3,
           available_at = $4,
           lease_expires_at = NULL,
           worker_id = NULL,
           updated_at = now()
       WHERE id = $1 AND worker_id = $2`,
      [id, workerId, error.slice(0, 8_000), nextAttempt],
    );
    return { deadLettered: false, retryAt: nextAttempt.toISOString() };
  }
}

export class ProgressOutboxSink implements ProgressSink {
  constructor(
    private readonly outbox: PostgresProgressOutbox,
    private readonly redactor = new SecretRedactor(),
    private readonly discussionId?: string,
  ) {}

  async publish(event: ProgressEvent): Promise<void> {
    const body = this.redactor.redact(renderProgress(event));
    const origin = event.task.origin;
    const base = {
      taskId: event.task.id,
      installationId: origin.installationId,
      repository: origin.repository,
      body,
    };

    await this.outbox.enqueue({
      ...base,
      eventKey: eventKey(event, "issue_comment", String(origin.issueNumber)),
      issueNumber: origin.issueNumber,
      destination: "issue_comment",
    });

    if (this.discussionId) {
      await this.outbox.enqueue({
        ...base,
        eventKey: eventKey(event, "discussion_comment", this.discussionId),
        destination: "discussion_comment",
        destinationRef: this.discussionId,
      });
    }
  }
}

export function renderProgress(event: ProgressEvent): string {
  const statuses = event.task.agents
    .map(
      (agent) =>
        `- ${agent.status === "completed" ? "✅" : agent.status === "running" ? "🔄" : agent.status === "failed" ? "❌" : "⏳"} ${agent.role}: ${agent.status}`,
    )
    .join("\n");

  return [
    `### 🤖 Sentient — ${event.headline}`,
    event.detail ? `\n${event.detail}` : "",
    `\n**Task:** \`${event.task.id}\``,
    `**Status:** ${event.task.status}`,
    "",
    statuses,
  ].join("\n");
}

function eventKey(event: ProgressEvent, destination: ProgressDestination, destinationRef: string): string {
  return createHash("sha256").update(JSON.stringify({
    taskId: event.task.id,
    updatedAt: event.task.updatedAt,
    headline: event.headline,
    detail: event.detail ?? "",
    destination,
    destinationRef,
  })).digest("hex");
}

function mapDelivery(row: any): ProgressDelivery {
  const payload = row.payload as { body?: unknown };
  if (!payload || typeof payload.body !== "string") throw new Error(
    `Progress delivery ${row.id} has invalid payload`,
  );
  return {
    id: row.id,
    taskId: row.task_id,
    installationId: Number(row.installation_id),
    repository: { owner: row.repository_owner, repo: row.repository_name },
    issueNumber: row.issue_number === null ? undefined : Number(row.issue_number),
    destination: row.destination,
    destinationRef: row.destination_ref ?? undefined,
    body: payload.body,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    leaseExpiresAt: row.lease_expires_at instanceof Date ? row.lease_expires_at.toISOString() : row.lease_expires_at ? new Date(row.lease_expires_at).toISOString() : undefined,
  };
}
