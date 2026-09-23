import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { AutomaticLeadSupervisor } from "../src/automatic-lead-supervisor.js";
import { LeadOrchestrationStore } from "../src/lead-orchestration.js";
import { PostgresTaskStore } from "../src/postgres.js";
import { SupervisedDemoRuntime } from "../src/supervised-demo-runtime.js";
import { RuntimeRegistry } from "../src/worker-control.js";
import { WorkerRuntimeReconciler } from "../src/worker-runtime-reconciler.js";
import { WorkerStore } from "../src/worker-store.js";

const url = process.env.DATABASE_URL;

test("automatic Lead supervision drives a task through planner, specialists, reviewer and integration readiness", { skip: !url }, async () => {
  const db = new Pool({ connectionString: url! });
  try {
    const tasks = new PostgresTaskStore(db);
    const task = await tasks.create(
      "prove automatic Lead supervision",
      {
        repository: { owner: "riggeyb", repo: "skills" },
        issueNumber: 66,
        installationId: 424242,
        deliveryId: randomUUID(),
        requestedBy: "automatic-lead-test",
      },
      [],
    );

    const workers = new WorkerStore(db);
    const runtime = new SupervisedDemoRuntime();
    const runtimes = new RuntimeRegistry([runtime]);
    const reconciler = new WorkerRuntimeReconciler(db, workers, runtimes, { leaseMs: 60_000 });
    const lead = new AutomaticLeadSupervisor(db, workers, new LeadOrchestrationStore(db), {
      leaseMs: 60_000,
      maxAttempts: 2,
    });

    for (let i = 0; i < 30; i++) {
      await lead.tick();
      await scheduleOneForTask(db, workers, runtimes, task.id);
      await reconciler.tick();
      await lead.tick();

      const current = await tasks.get(task.id);
      if (current.status === "completed") break;
    }

    const completed = await tasks.get(task.id);
    assert.equal(completed.status, "completed");

    const leadership = await db.query(
      `SELECT integration_ready_at,integration_ready_epoch
       FROM task_leadership
       WHERE task_id=$1`,
      [task.id],
    );
    assert.equal(leadership.rowCount, 1);
    assert.ok(leadership.rows[0].integration_ready_at);
    assert.equal(Number(leadership.rows[0].integration_ready_epoch), 1);

    const assignments = await db.query(
      `SELECT external_id,status,target_worker_id,spawn_request_id
       FROM worker_assignments
       WHERE task_id=$1
       ORDER BY external_id`,
      [task.id],
    );
    assert.deepEqual(
      assignments.rows.map((row) => [row.external_id, row.status]),
      [
        ["phase:backend", "accepted"],
        ["phase:frontend", "accepted"],
        ["phase:planner", "accepted"],
        ["phase:reviewer", "accepted"],
        ["phase:tests", "accepted"],
      ],
    );
    assert.ok(assignments.rows.every((row) => row.target_worker_id && row.spawn_request_id));

    const workerRows = await db.query(
      `SELECT role,status,count(*)::int AS n
       FROM sentient_workers
       WHERE task_id=$1
       GROUP BY role,status
       ORDER BY role,status`,
      [task.id],
    );
    assert.ok(workerRows.rows.some((row) => row.role === "lead" && row.status === "running" && row.n === 1));
    for (const role of ["planner", "backend", "frontend", "tests", "reviewer"]) {
      assert.ok(workerRows.rows.some((row) => row.role === role && row.status === "completed" && row.n === 1));
    }
  } finally {
    await db.end();
  }
});

async function scheduleOneForTask(
  db: Pool,
  store: WorkerStore,
  runtimes: RuntimeRegistry,
  taskId: string,
): Promise<void> {
  const result = await db.query(
    `SELECT *
     FROM worker_spawn_requests
     WHERE task_id=$1
       AND status IN ('pending','blocked')
       AND next_attempt_at<=now()
     ORDER BY created_at,id
     LIMIT 1`,
    [taskId],
  );
  const request = result.rows[0];
  if (!request) return;

  const requirements = {
    capabilities: request.required_capabilities ?? [],
    preferredModelTier: request.preferred_model_tier ?? undefined,
    maxCostUsd: request.max_cost_usd == null ? undefined : Number(request.max_cost_usd),
    maxDurationMs: request.max_duration_ms == null ? undefined : Number(request.max_duration_ms),
    workspaceRequirement: request.workspace_requirement ?? undefined,
  };
  const runtime = runtimes.select(requirements);
  assert.ok(runtime);

  const worker = await store.create(request, runtime.id, "automatic-lead-test-scheduler", 60_000);
  const { handle } = await runtime.spawn(worker, requirements);
  await store.handle(worker.id, handle);
  await runtime.assign(handle, worker.assignment);
  await store.transition(worker.id, "running");
}
