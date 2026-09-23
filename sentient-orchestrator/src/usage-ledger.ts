import type { Pool, PoolClient } from "pg";

export type UsageCategory = "model" | "compute" | "storage" | "network";

export interface UsageEvent {
  eventKey: string;
  installationId: number;
  repository?: { owner: string; repo: string };
  taskId?: string;
  agentRole?: string;
  actionRunId?: string;
  category: UsageCategory;
  source: string;
  quantity: number;
  unit: string;
  costMicrousd: number;
  correlationId?: string;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
}

export interface UsageRecord extends UsageEvent {
  id: string;
  occurredAt: Date;
  createdAt: Date;
}

type Queryable = Pick<Pool | PoolClient, "query">;

export class PostgresUsageLedger {
  constructor(private readonly pool: Pool) {}

  record(event: UsageEvent): Promise<UsageRecord> {
    return recordUsage(this.pool, event);
  }

  async monthlyCost(installationId: number, at = new Date()): Promise<number> {
    requirePositiveInstallationId(installationId);
    const result = await this.pool.query(
      `SELECT coalesce(sum(cost_microusd), 0)::bigint AS cost
       FROM usage_ledger
       WHERE installation_id = $1
         AND occurred_at >= date_trunc('month', $2::timestamptz)
         AND occurred_at < date_trunc('month', $2::timestamptz) + interval '1 month'`,
      [installationId, at],
    );
    return Number(result.rows[0].cost);
  }
}

export async function recordUsage(queryable: Queryable, event: UsageEvent): Promise<UsageRecord> {
  validateUsageEvent(event);
  const occurredAt = event.occurredAt ?? new Date();
  const result = await queryable.query(
    `INSERT INTO usage_ledger(
       event_key, installation_id, repository_owner, repository_name, task_id, agent_role,
       action_run_id, category, source, quantity, unit, cost_microusd, correlation_id,
       metadata, occurred_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15)
     ON CONFLICT (event_key) DO NOTHING
     RETURNING *`,
    [
      event.eventKey,
      event.installationId,
      event.repository?.owner ?? null,
      event.repository?.repo ?? null,
      event.taskId ?? null,
      event.agentRole ?? null,
      event.actionRunId ?? null,
      event.category,
      event.source,
      event.quantity,
      event.unit,
      event.costMicrousd,
      event.correlationId ?? null,
      JSON.stringify(event.metadata ?? {}),
      occurredAt,
    ],
  );

  const row =
    result.rowCount === 1
      ? result.rows[0]
      : (
          await queryable.query(`SELECT * FROM usage_ledger WHERE event_key = $1`, [event.eventKey])
        ).rows[0];

  if (!row) throw new Error(`Usage event ${event.eventKey} disappeared after insert`);
  if (
    Number(row.installation_id) !== event.installationId ||
    row.category !== event.category ||
    row.source !== event.source ||
    Number(row.quantity) !== event.quantity ||
    Number(row.cost_microusd) !== event.costMicrousd
  ) {
    throw new Error(`Usage event key collision for ${event.eventKey}`);
  }
  return mapUsage(row);
}

export function validateUsageEvent(event: UsageEvent): UsageEvent {
  if (!event.eventKey.trim() || event.eventKey.length > 512) throw new Error("Usage eventKey is invalid");
  requirePositiveInstallationId(event.installationId);
  if (!event.source.trim() || event.source.length > 160) throw new Error("Usage source is invalid");
  if (!event.unit.trim() || event.unit.length > 64) throw new Error("Usage unit is invalid");
  if (!Number.isSafeInteger(event.quantity) || event.quantity < 0) throw new Error("Usage quantity must be a non-negative safe integer");
  if (!Number.isSafeInteger(event.costMicrousd) || event.costMicrousd < 0) throw new Error("Usage costMicrousd must be a non-negative safe integer");
  return event;
}

function requirePositiveInstallationId(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("installationId must be a positive safe integer");
}

function mapUsage(row: any): UsageRecord {
  return {
    id: row.id,
    eventKey: row.event_key,
    installationId: Number(row.installation_id),
    repository:
      row.repository_owner && row.repository_name
        ? { owner: row.repository_owner, repo: row.repository_name }
        : undefined,
    taskId: row.task_id ?? undefined,
    agentRole: row.agent_role ?? undefined,
    actionRunId: row.action_run_id ?? undefined,
    category: row.category,
    source: row.source,
    quantity: Number(row.quantity),
    unit: row.unit,
    costMicrousd: Number(row.cost_microusd),
    correlationId: row.correlation_id ?? undefined,
    metadata: row.metadata ?? {},
    occurredAt: row.occurred_at instanceof Date ? row.occurred_at : new Date(row.occurred_at),
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
  };
}
