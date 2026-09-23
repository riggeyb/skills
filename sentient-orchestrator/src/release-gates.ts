import type { Pool } from "pg";

export type ReleaseGateCategory =
  | "backup"
  | "recovery"
  | "load"
  | "security"
  | "evaluation"
  | "smoke";

export type ReleaseGateStatus = "passed" | "failed" | "blocked";

const REQUIRED_CATEGORIES: readonly ReleaseGateCategory[] = [
  "backup",
  "recovery",
  "load",
  "security",
  "evaluation",
  "smoke",
];

export interface ReleaseGateResultInput {
  gateKey: string;
  category: ReleaseGateCategory;
  status: ReleaseGateStatus;
  evidence?: Record<string, unknown>;
  measuredValue?: number;
  thresholdValue?: number;
}

export interface ReleaseGateSummary {
  runId: string;
  revision: string;
  environment: string;
  status: "running" | ReleaseGateStatus;
  categories: Record<ReleaseGateCategory, ReleaseGateStatus | "missing">;
  missingCategories: ReleaseGateCategory[];
  failedCategories: ReleaseGateCategory[];
  blockedCategories: ReleaseGateCategory[];
}

export class PostgresReleaseGateService {
  constructor(private readonly pool: Pool) {}

  async start(input: {
    revision: string;
    environment: string;
    metadata?: Record<string, unknown>;
  }): Promise<string> {
    const revision = required(input.revision, "revision");
    const environment = required(input.environment, "environment");
    const result = await this.pool.query(
      `INSERT INTO release_gate_runs(revision, environment, metadata)
       VALUES ($1, $2, $3::jsonb)
       RETURNING id`,
      [revision, environment, JSON.stringify(input.metadata ?? {})],
    );
    return result.rows[0].id;
  }

  async record(runId: string, input: ReleaseGateResultInput): Promise<void> {
    required(runId, "runId");
    required(input.gateKey, "gateKey");
    validateFiniteOptional(input.measuredValue, "measuredValue");
    validateFiniteOptional(input.thresholdValue, "thresholdValue");

    await this.pool.query(
      `INSERT INTO release_gate_results(
         run_id, gate_key, category, status, evidence, measured_value, threshold_value
       )
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
       ON CONFLICT (run_id, gate_key) DO UPDATE SET
         category = EXCLUDED.category,
         status = EXCLUDED.status,
         evidence = EXCLUDED.evidence,
         measured_value = EXCLUDED.measured_value,
         threshold_value = EXCLUDED.threshold_value,
         created_at = now()`,
      [
        runId,
        input.gateKey,
        input.category,
        input.status,
        JSON.stringify(input.evidence ?? {}),
        input.measuredValue ?? null,
        input.thresholdValue ?? null,
      ],
    );
  }

  async summarize(runId: string): Promise<ReleaseGateSummary> {
    const run = await this.pool.query(
      `SELECT id, revision, environment, status
       FROM release_gate_runs
       WHERE id = $1`,
      [runId],
    );
    if (run.rowCount !== 1) throw new Error(`Unknown release gate run ${runId}`);

    const results = await this.pool.query(
      `SELECT category, status
       FROM release_gate_results
       WHERE run_id = $1`,
      [runId],
    );

    const categories = Object.fromEntries(
      REQUIRED_CATEGORIES.map((category) => [category, "missing"]),
    ) as Record<ReleaseGateCategory, ReleaseGateStatus | "missing">;

    for (const row of results.rows) {
      const category = row.category as ReleaseGateCategory;
      const current = categories[category];
      const next = row.status as ReleaseGateStatus;
      if (current === "failed" || next === current) continue;
      if (next === "failed" || current === "missing") {
        categories[category] = next;
      } else if (next === "blocked" && current === "passed") {
        categories[category] = "blocked";
      }
    }

    const missingCategories = REQUIRED_CATEGORIES.filter((category) => categories[category] === "missing");
    const failedCategories = REQUIRED_CATEGORIES.filter((category) => categories[category] === "failed");
    const blockedCategories = REQUIRED_CATEGORIES.filter((category) => categories[category] === "blocked");

    return {
      runId,
      revision: run.rows[0].revision,
      environment: run.rows[0].environment,
      status: run.rows[0].status,
      categories,
      missingCategories,
      failedCategories,
      blockedCategories,
    };
  }

  async finalize(runId: string): Promise<ReleaseGateSummary> {
    const summary = await this.summarize(runId);
    const status: ReleaseGateStatus =
      summary.failedCategories.length > 0
        ? "failed"
        : summary.blockedCategories.length > 0 || summary.missingCategories.length > 0
          ? "blocked"
          : "passed";

    await this.pool.query(
      `UPDATE release_gate_runs
       SET status = $2, completed_at = now()
       WHERE id = $1`,
      [runId, status],
    );
    return { ...summary, status };
  }

  async assertRevisionReady(revision: string, environment: string): Promise<ReleaseGateSummary> {
    required(revision, "revision");
    required(environment, "environment");

    const result = await this.pool.query(
      `SELECT id
       FROM release_gate_runs
       WHERE revision = $1 AND environment = $2 AND status = 'passed'
       ORDER BY completed_at DESC NULLS LAST, started_at DESC
       LIMIT 1`,
      [revision, environment],
    );
    if (result.rowCount !== 1) {
      throw new Error(`Revision ${revision} has no passed GA gate run for ${environment}`);
    }

    const summary = await this.summarize(result.rows[0].id);
    if (
      summary.missingCategories.length > 0 ||
      summary.failedCategories.length > 0 ||
      summary.blockedCategories.length > 0
    ) {
      throw new Error(`Revision ${revision} has incomplete GA evidence for ${environment}`);
    }
    return summary;
  }
}

export function requiredReleaseGateCategories(): readonly ReleaseGateCategory[] {
  return REQUIRED_CATEGORIES;
}

function required(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 512) throw new Error(`${name} is invalid`);
  return normalized;
}

function validateFiniteOptional(value: number | undefined, name: string): void {
  if (value !== undefined && !Number.isFinite(value)) throw new Error(`${name} must be finite`);
}
