import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import {
  PostgresReleaseGateService,
  requiredReleaseGateCategories,
  type ReleaseGateCategory,
} from "../src/release-gates.js";

const databaseUrl = process.env.DATABASE_URL;

test(
  "GA release gates block incomplete revisions and pass only with all required evidence",
  { skip: !databaseUrl },
  async () => {
    const pool = new Pool({ connectionString: databaseUrl! });
    try {
      const service = new PostgresReleaseGateService(pool);
      const revision = `rev-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const environment = "staging";

      const incomplete = await service.start({
        revision,
        environment,
        metadata: { source: "integration-test" },
      });
      await service.record(incomplete, {
        gateKey: "backup.latest",
        category: "backup",
        status: "passed",
        evidence: { snapshot: "test-snapshot" },
      });

      const incompleteSummary = await service.finalize(incomplete);
      assert.equal(incompleteSummary.status, "blocked");
      assert.ok(incompleteSummary.missingCategories.includes("recovery"));
      await assert.rejects(
        service.assertRevisionReady(revision, environment),
        /no passed GA gate run/,
      );

      const complete = await service.start({
        revision,
        environment,
        metadata: { source: "integration-test" },
      });

      for (const category of requiredReleaseGateCategories()) {
        await service.record(complete, passingGate(category));
      }

      const completeSummary = await service.finalize(complete);
      assert.equal(completeSummary.status, "passed");
      assert.deepEqual(completeSummary.missingCategories, []);
      assert.deepEqual(completeSummary.failedCategories, []);
      assert.deepEqual(completeSummary.blockedCategories, []);

      const ready = await service.assertRevisionReady(revision, environment);
      assert.equal(ready.runId, complete);
      assert.equal(ready.revision, revision);
      assert.equal(ready.environment, environment);
      assert.equal(ready.status, "passed");

      const evidence = await pool.query(
        `SELECT evidence
         FROM release_gate_results
         WHERE run_id = $1 AND gate_key = 'security.regression'`,
        [complete],
      );
      assert.equal(evidence.rowCount, 1);
      assert.equal(evidence.rows[0].evidence.kind, "security");
    } finally {
      await pool.end();
    }
  },
);

test(
  "a failed GA category makes the release gate fail",
  { skip: !databaseUrl },
  async () => {
    const pool = new Pool({ connectionString: databaseUrl! });
    try {
      const service = new PostgresReleaseGateService(pool);
      const runId = await service.start({
        revision: `failed-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        environment: "production",
      });

      for (const category of requiredReleaseGateCategories()) {
        await service.record(
          runId,
          category === "security"
            ? {
                gateKey: "security.regression",
                category,
                status: "failed",
                evidence: { reason: "tenant-isolation regression" },
              }
            : passingGate(category),
        );
      }

      const summary = await service.finalize(runId);
      assert.equal(summary.status, "failed");
      assert.deepEqual(summary.failedCategories, ["security"]);
    } finally {
      await pool.end();
    }
  },
);

function passingGate(category: ReleaseGateCategory) {
  return {
    gateKey: gateKey(category),
    category,
    status: "passed" as const,
    evidence: { kind: category, revisionBound: true },
    measuredValue: 1,
    thresholdValue: 1,
  };
}

function gateKey(category: ReleaseGateCategory): string {
  switch (category) {
    case "backup":
      return "backup.latest";
    case "recovery":
      return "recovery.restore-drill";
    case "load":
      return "load.capacity";
    case "security":
      return "security.regression";
    case "evaluation":
      return "evaluation.agent-quality";
    case "smoke":
      return "smoke.production";
  }
}
