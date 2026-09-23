import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PostgresTaskStore } from "../src/postgres.js";
import { RuntimeRegistry, type RuntimeRequirements, type SentientWorker, type WorkerRuntime } from "../src/worker-control.js";
import { WorkerRuntimeReconciler } from "../src/worker-runtime-reconciler.js";
import { WorkerStore } from "../src/worker-store.js";

const url = process.env.DATABASE_URL;

class ResultRuntime implements WorkerRuntime {
  readonly id = "result-runtime";
  constructor(private readonly result: unknown) {}
  compatible(requirements: RuntimeRequirements): boolean {
    return requirements.capabilities.includes("result-test");
  }
  async spawn(worker: SentientWorker): Promise<{ handle: string }> {
    return { handle: `result:${worker.id}` };
  }
  async assign(_handle: string, _assignment: unknown): Promise<void> {}
  async inspect(_handle: string): Promise<{ status: string; spentUsd?: number; result?: unknown }> {
    return { status: "completed", spentUsd: 0.02, result: this.result };
  }
  async cancel(_handle: string, _reason: string): Promise<void> {}
  async terminate(_handle: string, _reason: string): Promise<void> {}
}

test("runtime reconciler persists external Sentient handoff and audits it idempotently", { skip: !url }, async () => {
  const db = new Pool({ connectionString: url! });
  try {
    const tasks = new PostgresTaskStore(db);
    const task = await tasks.create(
      "persist remote result",
      {
        repository: { owner: "riggeyb", repo: "skills" },
        issueNumber: 66,
        installationId: 515151,
        deliveryId: randomUUID(),
        requestedBy: "remote-result-test",
      },
      [],
    );

    const handoff = {
      handoffId: `handoff-${randomUUID()}`,
      objective: "persist remote result",
      completedWork: ["completed"],
      filesCommitsArtifacts: ["commit:def"],
      findings: [],
      unresolvedQuestions: [],
      dependencies: [],
      testsResults: ["pass"],
      risks: [],
      recommendedNextAction: "review",
    };

    const store = new WorkerStore(db);
    const requested = await store.request({
      taskId: task.id,
      tenant: "tenant-result-test",
      repository: { owner: "riggeyb", repo: "skills" },
      role: "backend",
      assignment: { objective: "persist remote result" },
      requiredCapabilities: ["result-test"],
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      maxAttempts: 1,
    });
    const request = (await db.query(`SELECT * FROM worker_spawn_requests WHERE id=$1`, [requested.id])).rows[0];
    const runtime = new ResultRuntime(handoff);
    const worker = await store.create(request, runtime.id, "result-test-scheduler", 60_000);
    const { handle } = await runtime.spawn(worker, { capabilities: ["result-test"] });
    await store.handle(worker.id, handle);
    await runtime.assign(handle, worker.assignment);
    await store.transition(worker.id, "running");

    const reconciler = new WorkerRuntimeReconciler(db, store, new RuntimeRegistry([runtime]), { leaseMs: 60_000 });
    assert.equal(await reconciler.tick(), 1);

    const persisted = await db.query(
      `SELECT status,runtime_result,spent_usd FROM sentient_workers WHERE id=$1`,
      [worker.id],
    );
    assert.equal(persisted.rows[0].status, "completed");
    assert.deepEqual(persisted.rows[0].runtime_result, handoff);

    const events = await db.query(
      `SELECT event_type,payload FROM remote_worker_events WHERE worker_id=$1 ORDER BY id`,
      [worker.id],
    );
    assert.equal(events.rowCount, 1);
    assert.equal(events.rows[0].event_type, "RESULT_REPORTED");
    assert.deepEqual(events.rows[0].payload.result, handoff);

    assert.equal(await reconciler.tick(), 0);
    const eventCount = await db.query(
      `SELECT count(*)::int AS n FROM remote_worker_events WHERE worker_id=$1`,
      [worker.id],
    );
    assert.equal(eventCount.rows[0].n, 1);
  } finally {
    await db.end();
  }
});
