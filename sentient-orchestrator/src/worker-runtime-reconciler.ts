import type { Pool } from "pg";
import type { RuntimeRegistry } from "./worker-control.js";
import { WorkerStore } from "./worker-store.js";

export interface WorkerRuntimeReconcilerOptions {
  leaseMs?: number;
  batchSize?: number;
}

export class WorkerRuntimeReconciler {
  private readonly leaseMs: number;
  private readonly batchSize: number;

  constructor(
    private readonly db: Pool,
    private readonly store: WorkerStore,
    private readonly runtimes: RuntimeRegistry,
    options: WorkerRuntimeReconcilerOptions = {},
  ) {
    this.leaseMs = options.leaseMs ?? 60_000;
    this.batchSize = options.batchSize ?? 64;
  }

  async tick(): Promise<number> {
    const rows = await this.db.query(
      `SELECT id
       FROM sentient_workers
       WHERE status IN ('starting','running','blocked','waiting')
         AND runtime_id IS NOT NULL
         AND runtime_handle IS NOT NULL
       ORDER BY created_at,id
       LIMIT $1`,
      [this.batchSize],
    );

    let changed = 0;
    for (const row of rows.rows) {
      const worker = await this.store.get(row.id);
      if (!worker.runtimeId || !worker.runtimeHandle) continue;
      const runtime = this.runtimes.get(worker.runtimeId);
      if (!runtime) continue;

      const state = await runtime.inspect(worker.runtimeHandle);
      if (state.result !== undefined) {
        await this.persistResult(worker.id, state.result);
      }

      if (state.status === "completed") {
        await this.store.transition(worker.id, "completed");
        changed++;
        continue;
      }
      if (state.status === "failed") {
        const failed = await this.store.transition(worker.id, "failed", state.reason ?? "runtime_failed");
        await this.store.retry(failed, state.reason ?? "runtime_failed");
        changed++;
        continue;
      }
      if (state.status === "cancelled") {
        await this.store.transition(worker.id, "cancelled", state.reason ?? "runtime_cancelled");
        changed++;
        continue;
      }
      if (state.status === "running" && worker.status === "starting") {
        await this.store.transition(worker.id, "running");
        changed++;
      }
      if (worker.leaseOwner && ["starting","running","blocked","waiting"].includes(worker.status)) {
        await this.store.heartbeat(worker.id, worker.leaseOwner, this.leaseMs, state.spentUsd);
      }
    }
    return changed;
  }

  private async persistResult(workerId: string, result: unknown): Promise<void> {
    const serialized = JSON.stringify(result);
    if (serialized === undefined) throw new Error("Worker runtime result must be JSON-serializable");

    const updated = await this.db.query(
      `UPDATE sentient_workers
       SET runtime_result=$2::jsonb
       WHERE id=$1
         AND runtime_result IS DISTINCT FROM $2::jsonb
       RETURNING id`,
      [workerId, serialized],
    );
    if (!updated.rowCount) return;

    await this.db.query(
      `INSERT INTO remote_worker_events(worker_id,event_type,payload)
       VALUES($1,'RESULT_REPORTED',$2::jsonb)`,
      [workerId, JSON.stringify({ result })],
    );
  }
}
