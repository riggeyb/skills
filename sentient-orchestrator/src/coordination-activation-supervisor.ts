import type { Pool } from "pg";
import type {
  RuntimeRegistry,
  RuntimeRequirements,
  SentientWorker,
} from "./worker-control.js";
import { WorkerStore } from "./worker-store.js";
import { CoordinationActivationWatchdog } from "./coordination-activation-watchdog.js";
import {
  CoordinationActivationClaimStore,
  type CoordinationActivationRow,
} from "./coordination-activation-claim-store.js";
import { CoordinationActivationSettlementStore } from "./coordination-activation-settlement-store.js";

export interface CoordinationActivationSupervisorOptions {
  leaseMs?: number;
  batchSize?: number;
  retryBackoffMs?: number;
}

export class CoordinationActivationSupervisor {
  private readonly leaseMs: number;
  private readonly batchSize: number;
  private readonly retryBackoffMs: number;
  private readonly watchdog: CoordinationActivationWatchdog;
  private readonly claims: CoordinationActivationClaimStore;
  private readonly settlements: CoordinationActivationSettlementStore;

  constructor(
    private readonly db: Pool,
    private readonly workers: WorkerStore,
    private readonly runtimes: RuntimeRegistry,
    private readonly id: string,
    options: CoordinationActivationSupervisorOptions = {},
  ) {
    this.leaseMs = options.leaseMs ?? 60_000;
    this.batchSize = options.batchSize ?? 32;
    this.retryBackoffMs = options.retryBackoffMs ?? 1_000;
    this.watchdog = new CoordinationActivationWatchdog(db);
    this.claims = new CoordinationActivationClaimStore(db);
    this.settlements = new CoordinationActivationSettlementStore(db);
  }

  async tick(): Promise<number> {
    let changed = await this.watchdog.tick();
    changed += await this.claims.recoverExpiredClaims(this.id, this.leaseMs);
    changed += await this.reconcileRunning();

    for (let i = 0; i < this.batchSize; i++) {
      const activation = await this.claims.claim(this.id, this.leaseMs);
      if (!activation) break;
      await this.startClaimed(activation);
      changed++;
    }
    return changed;
  }

  private async reconcileRunning(): Promise<number> {
    let changed = 0;
    for (const row of await this.claims.running(this.batchSize)) {
      const worker = await this.workers.get(row.recipient_worker_id);
      const runtime = worker.runtimeId ? this.runtimes.get(worker.runtimeId) : null;
      if (!runtime) {
        await this.settlements.fail(
          row.activation_id,
          "coordination_runtime_unavailable",
          true,
          this.retryBackoffMs,
        );
        changed++;
        continue;
      }

      const state = await runtime.inspect(row.runtime_handle);
      if (state.status === "starting") {
        try {
          await runtime.assign(row.runtime_handle, worker.assignment);
          await this.workers.heartbeat(worker.id, this.id, this.leaseMs, state.spentUsd);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          try {
            await runtime.cancel(row.runtime_handle, "coordination_activation_start_failed");
          } catch {
            // Settlement below is authoritative; cancellation is best effort.
          }
          let spentUsd = state.spentUsd ?? 0;
          try {
            spentUsd = (await runtime.inspect(row.runtime_handle)).spentUsd ?? spentUsd;
          } catch {
            // Preserve last known spend.
          }
          await this.settlements.finish(
            row.activation_id,
            row.runtime_handle,
            false,
            reason,
            spentUsd,
            this.retryBackoffMs,
          );
          changed++;
        }
        continue;
      }
      if (state.status === "running") {
        await this.workers.heartbeat(worker.id, this.id, this.leaseMs, state.spentUsd);
        continue;
      }

      await this.settlements.finish(
        row.activation_id,
        row.runtime_handle,
        state.status === "completed",
        state.status === "completed" ? undefined : state.reason ?? `coordination_runtime_${state.status}`,
        state.spentUsd ?? 0,
        this.retryBackoffMs,
      );
      changed++;
    }
    return changed;
  }

  private async startClaimed(activation: CoordinationActivationRow): Promise<void> {
    const worker = await this.workers.get(activation.recipient_worker_id);
    const runtime = worker.runtimeId ? this.runtimes.get(worker.runtimeId) : null;
    if (!runtime?.activate) {
      await this.settlements.fail(
        activation.activation_id,
        "coordination_runtime_activation_unsupported",
        true,
        this.retryBackoffMs,
      );
      return;
    }

    let requirements: RuntimeRequirements;
    try {
      requirements = await this.requirements(worker);
    } catch (error) {
      await this.settlements.fail(
        activation.activation_id,
        error instanceof Error ? error.message : String(error),
        true,
        this.retryBackoffMs,
      );
      return;
    }

    let handle: string | undefined;
    try {
      const activated = await runtime.activate(worker, requirements, {
        activationId: activation.activation_id,
        triggerMessageId: activation.message_id,
        activationAttempt: Number(activation.activation_attempts),
      });
      handle = activated.handle;
      const bound = await this.claims.bindRunning(
        activation.activation_id,
        worker.id,
        handle,
        this.id,
        this.leaseMs,
      );
      if (!bound) {
        await runtime.cancel(handle, "coordination_activation_binding_lost");
        await this.settlements.fail(
          activation.activation_id,
          "coordination_activation_binding_lost",
          false,
          this.retryBackoffMs,
        );
      }
    } catch (error) {
      if (handle) {
        try {
          await runtime.cancel(handle, "coordination_activation_start_failed");
        } catch {
          // Settlement below is authoritative; cancellation is best effort.
        }
      }
      const reason = error instanceof Error ? error.message : String(error);
      const forceDeadLetter =
        reason.includes("budget") ||
        reason.includes("capability_boundary") ||
        reason.includes("identity_boundary") ||
        reason.includes("repository_boundary");
      await this.settlements.fail(
        activation.activation_id,
        reason,
        forceDeadLetter,
        this.retryBackoffMs,
      );
    }
  }

  private async requirements(worker: SentientWorker): Promise<RuntimeRequirements> {
    const request = await this.db.query(
      `SELECT required_capabilities,preferred_model_tier,max_duration_ms,workspace_requirement
       FROM worker_spawn_requests
       WHERE id=$1`,
      [worker.spawnRequestId],
    );
    if (request.rowCount !== 1) throw new Error("coordination_spawn_request_missing");
    const row = request.rows[0];

    let remainingBudget: number | undefined;
    if (worker.budgetUsd !== undefined) {
      remainingBudget = worker.budgetUsd - worker.spentUsd;
      if (!(remainingBudget > 0)) throw new Error("coordination_budget_exhausted");
    }

    return {
      capabilities: Array.isArray(row.required_capabilities)
        ? row.required_capabilities
        : worker.capabilities ?? [],
      preferredModelTier:
        typeof row.preferred_model_tier === "string" ? row.preferred_model_tier : undefined,
      maxCostUsd: remainingBudget,
      maxDurationMs:
        row.max_duration_ms == null ? undefined : Number(row.max_duration_ms),
      workspaceRequirement: row.workspace_requirement ?? worker.workspaceAssignment,
    };
  }
}
