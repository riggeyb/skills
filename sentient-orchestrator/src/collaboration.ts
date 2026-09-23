import type { Pool } from "pg";

export type CollaborationKind =
  | "NOTE"
  | "FINDING"
  | "QUESTION"
  | "ANSWER"
  | "BLOCKER"
  | "REQUEST"
  | "DECISION"
  | "HANDOFF"
  | "CLAIM"
  | "RELEASE"
  | "REVIEW_FINDING"
  | "COMPLETION";

export interface CollaborationMessage {
  id: string;
  taskId: string;
  kind: CollaborationKind;
  fromAgent: string;
  toAgent?: string;
  body: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface CollaborationBus {
  publish(input: {
    taskId: string;
    kind: CollaborationKind;
    fromAgent: string;
    toAgent?: string;
    body: string;
    details?: Record<string, unknown>;
  }): Promise<CollaborationMessage>;
  list(taskId: string, agentId?: string): Promise<CollaborationMessage[]>;
  claimResource(
    taskId: string,
    agentId: string,
    resourceKey: string,
    ttlMs: number,
  ): Promise<boolean>;
  releaseResource(
    taskId: string,
    agentId: string,
    resourceKey: string,
  ): Promise<boolean>;
}

export class PostgresCollaborationBus implements CollaborationBus {
  constructor(private readonly pool: Pool) {}

  async publish(input: {
    taskId: string;
    kind: CollaborationKind;
    fromAgent: string;
    toAgent?: string;
    body: string;
    details?: Record<string, unknown>;
  }): Promise<CollaborationMessage> {
    const result = await this.pool.query(
      `INSERT INTO task_messages(
         task_id, role, body, kind, from_agent, to_agent, details
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING id, task_id, kind, from_agent, to_agent, body, details, created_at`,
      [
        input.taskId,
        input.fromAgent,
        input.body,
        input.kind,
        input.fromAgent,
        input.toAgent ?? null,
        JSON.stringify(input.details ?? {}),
      ],
    );
    return mapMessage(result.rows[0]);
  }

  async list(taskId: string, agentId?: string): Promise<CollaborationMessage[]> {
    const result = await this.pool.query(
      `SELECT id, task_id, kind, from_agent, to_agent, body, details, created_at
       FROM task_messages
       WHERE task_id = $1
         AND ($2::text IS NULL OR to_agent IS NULL OR to_agent = $2 OR from_agent = $2)
       ORDER BY created_at, id`,
      [taskId, agentId ?? null],
    );
    return result.rows.map(mapMessage);
  }

  async claimResource(
    taskId: string,
    agentId: string,
    resourceKey: string,
    ttlMs: number,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO task_resource_claims(task_id, resource_key, agent_id, expires_at)
       VALUES ($1, $2, $3, now() + ($4 * interval '1 millisecond'))
       ON CONFLICT (task_id, resource_key) DO UPDATE
       SET agent_id = EXCLUDED.agent_id,
           expires_at = EXCLUDED.expires_at,
           created_at = now()
       WHERE task_resource_claims.expires_at <= now()
          OR task_resource_claims.agent_id = EXCLUDED.agent_id
       RETURNING resource_key`,
      [taskId, resourceKey, agentId, ttlMs],
    );
    return result.rowCount === 1;
  }

  async releaseResource(
    taskId: string,
    agentId: string,
    resourceKey: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM task_resource_claims
       WHERE task_id = $1 AND resource_key = $2 AND agent_id = $3
       RETURNING resource_key`,
      [taskId, resourceKey, agentId],
    );
    return result.rowCount === 1;
  }
}

function mapMessage(row: any): CollaborationMessage {
  return {
    id: row.id,
    taskId: row.task_id,
    kind: row.kind,
    fromAgent: row.from_agent,
    toAgent: row.to_agent ?? undefined,
    body: row.body,
    details: row.details ?? {},
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
  };
}
