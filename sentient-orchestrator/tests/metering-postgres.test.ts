import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import {
  BudgetExceededError,
  PostgresBudgetManager,
} from "../src/budget.js";
import { PostgresUsageLedger } from "../src/usage-ledger.js";

const databaseUrl = process.env.DATABASE_URL;

test(
  "budget reservations are atomic and usage ledger is idempotent and append-only",
  { skip: !databaseUrl },
  async () => {
    const pool = new Pool({ connectionString: databaseUrl! });
    try {
      const installationId = uniqueInstallationId();
      await pool.query(
        `INSERT INTO github_installations(installation_id, account_login, status)
         VALUES ($1, $2, 'active')`,
        [installationId, `budget-${installationId}`],
      );

      const budgets = new PostgresBudgetManager(pool);
      const ledger = new PostgresUsageLedger(pool);
      await budgets.setBudget({
        installationId,
        monthlyLimitMicrousd: 1_000,
        softLimitPercent: 80,
        hardLimit: true,
      });

      const attempts = await Promise.allSettled([
        budgets.reserve({
          reservationKey: `race-a-${installationId}`,
          installationId,
          amountMicrousd: 600,
          ttlMs: 60_000,
          correlationId: `corr-${installationId}`,
        }),
        budgets.reserve({
          reservationKey: `race-b-${installationId}`,
          installationId,
          amountMicrousd: 600,
          ttlMs: 60_000,
          correlationId: `corr-${installationId}`,
        }),
      ]);

      const successes = attempts.filter(
        (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof budgets.reserve>>> =>
          result.status === "fulfilled",
      );
      const failures = attempts.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      assert.equal(successes.length, 1);
      assert.equal(failures.length, 1);
      assert.ok(failures[0]!.reason instanceof BudgetExceededError);

      const reservation = successes[0]!.value;
      const duplicate = await budgets.reserve({
        reservationKey: reservation.reservationKey,
        installationId,
        amountMicrousd: 600,
        ttlMs: 60_000,
        correlationId: `corr-${installationId}`,
      });
      assert.equal(duplicate.id, reservation.id);

      const usage = {
        eventKey: `model-call-${installationId}`,
        installationId,
        category: "model" as const,
        source: "test-provider/test-model",
        quantity: 150,
        unit: "tokens",
        costMicrousd: 600,
        correlationId: `corr-${installationId}`,
        metadata: { capability: "coding.deep", success: true },
      };

      const first = await budgets.commit(reservation.id, usage);
      const second = await budgets.commit(reservation.id, usage);
      assert.equal(first.id, second.id);
      assert.equal(await ledger.monthlyCost(installationId), 600);

      const rows = await pool.query(
        `SELECT count(*)::integer AS count
         FROM usage_ledger
         WHERE event_key = $1`,
        [usage.eventKey],
      );
      assert.equal(rows.rows[0].count, 1);

      await assert.rejects(
        pool.query(
          `UPDATE usage_ledger
           SET cost_microusd = cost_microusd + 1
           WHERE event_key = $1`,
          [usage.eventKey],
        ),
        /append-only/,
      );

      await assert.rejects(
        budgets.reserve({
          reservationKey: `after-spend-${installationId}`,
          installationId,
          amountMicrousd: 500,
          ttlMs: 60_000,
        }),
        (error: unknown) => error instanceof BudgetExceededError,
      );
    } finally {
      await pool.end();
    }
  },
);

function uniqueInstallationId(): number {
  const timePart = Number(Date.now().toString().slice(-8));
  return Number(`4${timePart}${randomInt(10, 99)}`);
}
