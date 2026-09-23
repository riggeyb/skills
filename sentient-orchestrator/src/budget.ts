import type { Pool, PoolClient } from "pg";
import { recordUsage, type UsageEvent, type UsageRecord } from "./usage-ledger.js";

export class BudgetExceededError extends Error {
  constructor(
    public readonly installationId: number,
    public readonly limitMicrousd: number,
    public readonly spentMicrousd: number,
    public readonly reservedMicrousd: number,
    public readonly requestedMicrousd: number,
  ) {
    super(
      `Tenant ${installationId} budget exceeded: ${spentMicrousd + reservedMicrousd + requestedMicrousd} > ${limitMicrousd} microusd`,
    );
    this.name = "BudgetExceededError";
  }
}

export interface BudgetReservation {
  id: string;
  reservationKey: string;
  installationId: number;
  amountMicrousd: number;
  expiresAt: Date;
  softLimitExceeded: boolean;
  limitMicrousd?: number;
  projectedMicrousd: number;
}

export class PostgresBudgetManager {
  constructor(private readonly pool: Pool) {}

  async setBudget(input: {
    installationId: number;
    monthlyLimitMicrousd: number;
    softLimitPercent?: number;
    hardLimit?: boolean;
    enabled?: boolean;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    requirePositive(input.installationId, "installationId");
    requirePositive(input.monthlyLimitMicrousd, "monthlyLimitMicrousd");
    const soft = input.softLimitPercent ?? 80;
    if (!Number.isSafeInteger(soft) || soft < 1 || soft > 100) {
      throw new Error("softLimitPercent must be an integer between 1 and 100");
    }
    await this.pool.query(
      `INSERT INTO tenant_budgets(
         installation_id, monthly_limit_microusd, soft_limit_percent,
         hard_limit, enabled, metadata
       )
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)
       ON CONFLICT (installation_id) DO UPDATE SET
         monthly_limit_microusd = EXCLUDED.monthly_limit_microusd,
         soft_limit_percent = EXCLUDED.soft_limit_percent,
         hard_limit = EXCLUDED.hard_limit,
         enabled = EXCLUDED.enabled,
         metadata = EXCLUDED.metadata,
         updated_at = now()`,
      [
        input.installationId,
        input.monthlyLimitMicrousd,
        soft,
        input.hardLimit ?? true,
        input.enabled ?? true,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }

  async reserve(input: {
    reservationKey: string;
    installationId: number;
    amountMicrousd: number;
    ttlMs: number;
    repository?: { owner: string; repo: string };
    taskId?: string;
    correlationId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<BudgetReservation> {
    validateReservationInput(input);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(
        `SELECT * FROM budget_reservations WHERE reservation_key = $1 FOR UPDATE`,
        [input.reservationKey],
      );
      if (existing.rowCount === 1) {
        const row = existing.rows[0];
        if (
          Number(row.installation_id) !== input.installationId ||
          Number(row.amount_microusd) !== input.amountMicrousd
        ) {
          throw new Error(`Budget reservation key collision for ${input.reservationKey}`);
        }
        const snapshot = await budgetSnapshot(client, input.installationId, 0);
        await client.query("COMMIT");
        return mapReservation(row, snapshot);
      }

      await client.query(
        `UPDATE budget_reservations
         SET status = 'expired', updated_at = now()
         WHERE installation_id = $1 AND status = 'active' AND expires_at <= now()`,
        [input.installationId],
      );

      const budget = await client.query(
        `SELECT * FROM tenant_budgets WHERE installation_id = $1 FOR UPDATE`,
        [input.installationId],
      );
      const snapshot = await budgetSnapshot(client, input.installationId, input.amountMicrousd);
      if (budget.rowCount === 1 && budget.rows[0].enabled) {
        const limit = Number(budget.rows[0].monthly_limit_microusd);
        if (budget.rows[0].hard_limit && snapshot.projectedMicrousd > limit) {
          throw new BudgetExceededError(
            input.installationId,
            limit,
            snapshot.spentMicrousd,
            snapshot.reservedMicrousd,
            input.amountMicrousd,
          );
        }
      }

      const expiresAt = new Date(Date.now() + input.ttlMs);
      const inserted = await client.query(
        `INSERT INTO budget_reservations(
           reservation_key, installation_id, repository_owner, repository_name, task_id,
           amount_microusd, expires_at, correlation_id, metadata
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
         RETURNING *`,
        [
          input.reservationKey,
          input.installationId,
          input.repository?.owner ?? null,
          input.repository?.repo ?? null,
          input.taskId ?? null,
          input.amountMicrousd,
          expiresAt,
          input.correlationId ?? null,
          JSON.stringify(input.metadata ?? {}),
        ],
      );
      await client.query("COMMIT");
      return mapReservation(inserted.rows[0], snapshot);
    } catch (error) {
      await safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async commit(reservationId: string, event: UsageEvent): Promise<UsageRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `SELECT * FROM budget_reservations WHERE id = $1 FOR UPDATE`,
        [reservationId],
      );
      if (result.rowCount !== 1) throw new Error(`Unknown budget reservation ${reservationId}`);
      const row = result.rows[0];
      if (Number(row.installation_id) !== event.installationId) {
        throw new Error("Usage event installation does not match reservation");
      }
      if (row.status === "released" || row.status === "expired") {
        throw new Error(`Budget reservation ${reservationId} is ${row.status}`);
      }
      if (row.status === "active" && new Date(row.expires_at).getTime() <= Date.now()) {
        await client.query(
          `UPDATE budget_reservations SET status = 'expired', updated_at = now() WHERE id = $1`,
          [reservationId],
        );
        throw new Error(`Budget reservation ${reservationId} expired`);
      }

      const usage = await recordUsage(client, event);
      if (row.status === "active") {
        await client.query(
          `UPDATE budget_reservations
           SET status = 'committed', committed_event_key = $2, updated_at = now()
           WHERE id = $1`,
          [reservationId, event.eventKey],
        );
      } else if (row.committed_event_key !== event.eventKey) {
        throw new Error(`Reservation ${reservationId} was committed with a different usage event`);
      }
      await client.query("COMMIT");
      return usage;
    } catch (error) {
      await safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async release(reservationId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE budget_reservations
       SET status = 'released', updated_at = now()
       WHERE id = $1 AND status = 'active'
       RETURNING id`,
      [reservationId],
    );
    return result.rowCount === 1;
  }
}

async function budgetSnapshot(
  client: PoolClient,
  installationId: number,
  requestedMicrousd: number,
): Promise<{
  spentMicrousd: number;
  reservedMicrousd: number;
  projectedMicrousd: number;
  limitMicrousd?: number;
  softLimitExceeded: boolean;
}> {
  const [spentResult, reservedResult, budgetResult] = await Promise.all([
    client.query(
      `SELECT coalesce(sum(cost_microusd), 0)::bigint AS value
       FROM usage_ledger
       WHERE installation_id = $1 AND occurred_at >= date_trunc('month', now())`,
      [installationId],
    ),
    client.query(
      `SELECT coalesce(sum(amount_microusd), 0)::bigint AS value
       FROM budget_reservations
       WHERE installation_id = $1 AND status = 'active' AND expires_at > now()`,
      [installationId],
    ),
    client.query(`SELECT * FROM tenant_budgets WHERE installation_id = $1`, [installationId]),
  ]);
  const spentMicrousd = Number(spentResult.rows[0].value);
  const reservedMicrousd = Number(reservedResult.rows[0].value);
  const projectedMicrousd = spentMicrousd + reservedMicrousd + requestedMicrousd;
  if (budgetResult.rowCount !== 1 || !budgetResult.rows[0].enabled) {
    return { spentMicrousd, reservedMicrousd, projectedMicrousd, softLimitExceeded: false };
  }
  const limitMicrousd = Number(budgetResult.rows[0].monthly_limit_microusd);
  const softLimit = Math.floor((limitMicrousd * Number(budgetResult.rows[0].soft_limit_percent)) / 100);
  return {
    spentMicrousd,
    reservedMicrousd,
    projectedMicrousd,
    limitMicrousd,
    softLimitExceeded: projectedMicrousd >= softLimit,
  };
}

function mapReservation(
  row: any,
  snapshot: {
    projectedMicrousd: number;
    limitMicrousd?: number;
    softLimitExceeded: boolean;
  },
): BudgetReservation {
  return {
    id: row.id,
    reservationKey: row.reservation_key,
    installationId: Number(row.installation_id),
    amountMicrousd: Number(row.amount_microusd),
    expiresAt: row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at),
    projectedMicrousd: snapshot.projectedMicrousd,
    limitMicrousd: snapshot.limitMicrousd,
    softLimitExceeded: snapshot.softLimitExceeded,
  };
}

function validateReservationInput(input: {
  reservationKey: string;
  installationId: number;
  amountMicrousd: number;
  ttlMs: number;
}): void {
  if (!input.reservationKey.trim() || input.reservationKey.length > 512) {
    throw new Error("reservationKey is invalid");
  }
  requirePositive(input.installationId, "installationId");
  requirePositive(input.amountMicrousd, "amountMicrousd");
  if (!Number.isSafeInteger(input.ttlMs) || input.ttlMs < 1_000 || input.ttlMs > 24 * 60 * 60_000) {
    throw new Error("ttlMs must be between 1000 and 86400000");
  }
}

function requirePositive(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer`);
}

async function safeRollback(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original failure.
  }
}
