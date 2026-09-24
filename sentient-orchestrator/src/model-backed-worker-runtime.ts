import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type {
  RuntimeRequirements,
  SentientWorker,
  WorkerActivationRequest,
  WorkerRuntime,
  WorkerRuntimeState,
} from "./worker-control.js";
import {
  ModelExecutionAdapterRegistry,
  type ModelExecutionAdapter,
  type ModelExecutionRequest,
} from "./model-execution.js";
import {
  ModelBudgetExceededError,
  normalizeModelResponse,
} from "./model-runtime-validation.js";
import {
  applyModelCoordinationActions,
  prepareModelCoordination,
} from "./model-coordination.js";
import { ModelCoordinationActivationRuntime } from "./model-coordination-activation-runtime.js";
import type { SentientCoordinationService } from "./sentient-coordination.js";

interface ActiveExecution {
  controller: AbortController;
  promise: Promise<void>;
}

export class ModelBackedWorkerRuntime implements WorkerRuntime {
  readonly id = "model-backed";
  private readonly active = new Map<string, ActiveExecution>();
  private readonly coordinationActivations: ModelCoordinationActivationRuntime;

  constructor(
    private readonly db: Pool,
    private readonly adapters: ModelExecutionAdapterRegistry,
    private readonly coordination?: SentientCoordinationService,
  ) {
    this.coordinationActivations = new ModelCoordinationActivationRuntime(db, adapters, coordination);
  }

  compatible(requirements: RuntimeRequirements): boolean {
    return this.adapters.select(requirements) !== null;
  }

  async spawn(
    worker: SentientWorker,
    requirements: RuntimeRequirements,
  ): Promise<{ handle: string }> {
    const adapter = this.adapters.select(requirements);
    if (!adapter) throw new Error("no_compatible_model_adapter");
    const durable = await this.loadDurableWorker(worker.id);
    this.assertIdentity(worker, durable);
    const capabilities = stringArray(durable.capabilities);
    if (!requirements.capabilities.every((capability) => capabilities.includes(capability))) {
      throw new Error("worker_capability_boundary_violation");
    }
    const budgetUsd = durable.budget_usd == null ? undefined : Number(durable.budget_usd);
    if (
      budgetUsd !== undefined &&
      requirements.maxCostUsd !== undefined &&
      requirements.maxCostUsd > budgetUsd
    ) {
      throw new Error("worker_budget_boundary_violation");
    }

    const handle = `model:${worker.id}:attempt:${worker.attemptCount}`;
    const request: ModelExecutionRequest = {
      executionId: handle,
      idempotencyKey: `${worker.id}:${worker.attemptCount}`,
      identity: {
        workerId: worker.id,
        spawnRequestId: durable.spawn_request_id,
        taskId: durable.task_id,
        tenant: durable.tenant,
        repository: {
          owner: durable.repository_owner,
          repo: durable.repository_name,
        },
        role: durable.role,
        parentWorkerId: durable.parent_worker_id ?? undefined,
        coordinatorId: durable.coordinator_id ?? undefined,
        correlationId: durable.correlation_id,
        attemptCount: Number(durable.attempt_count),
      },
      assignment: durable.assignment,
      boundaries: {
        capabilities,
        authority: objectValue(durable.authority),
        workspace: durable.workspace_assignment ?? undefined,
        budgetUsd,
        maxDurationMs: requirements.maxDurationMs,
      },
      responseContract: {
        version: "sentient-worker-result/v1",
        privateReasoningForbidden: true,
        fields: [
          "status",
          "conclusion",
          "evidence",
          "artifacts",
          "toolResults",
          "handoff",
          "failureReason",
          "usage",
          "coordinationActions",
        ],
      },
    };
    const requestHash = digest(request);
    const assignmentHash = digest(durable.assignment);
    await this.db.query(
      `INSERT INTO worker_runtime_executions(
         worker_id,runtime_handle,runtime_id,adapter_id,provider_id,model_id,
         request,request_hash,assignment_hash,status
       )
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,'starting')
       ON CONFLICT(worker_id) DO NOTHING`,
      [
        worker.id,
        handle,
        this.id,
        adapter.id,
        adapter.providerId,
        adapter.modelId ?? null,
        JSON.stringify(request),
        requestHash,
        assignmentHash,
      ],
    );
    const existing = await this.loadExecution(handle);
    if (
      existing.worker_id !== worker.id ||
      existing.runtime_id !== this.id ||
      existing.adapter_id !== adapter.id ||
      existing.request_hash !== requestHash ||
      existing.assignment_hash !== assignmentHash
    ) {
      throw new Error("runtime_execution_identity_conflict");
    }
    return { handle };
  }

  async assign(handle: string, assignment: unknown): Promise<void> {
    let execution = await this.loadExecution(handle);
    if (execution.assignment_hash !== digest(assignment)) {
      throw new Error("assignment_boundary_violation");
    }
    if (isTerminal(execution.status)) return;
    if (execution.status === "running") {
      if (this.active.has(handle)) return;
      await this.failUnknownInFlight(handle);
      throw new Error("runtime_restart_unknown_outcome");
    }

    const adapter = this.adapters.get(execution.adapter_id);
    if (!adapter) throw new Error(`unknown_model_adapter:${execution.adapter_id}`);
    await this.db.query(
      `UPDATE worker_runtime_executions
       SET status='running',started_at=coalesce(started_at,now()),updated_at=now()
       WHERE runtime_handle=$1 AND status='starting'`,
      [handle],
    );
    execution = await this.loadExecution(handle);
    const controller = new AbortController();
    const promise = this.execute(handle, execution.request, adapter, controller)
      .finally(() => this.active.delete(handle));
    this.active.set(handle, { controller, promise });
  }

  async inspect(handle: string): Promise<WorkerRuntimeState> {
    let execution = await this.loadExecution(handle);
    if (execution.status === "running" && !this.active.has(handle)) {
      await this.failUnknownInFlight(handle);
      execution = await this.loadExecution(handle);
    }
    return {
      status: execution.status,
      spentUsd: Number(execution.spent_usd),
      reason: execution.failure_reason ?? undefined,
      result: execution.result ?? undefined,
    };
  }

  async cancel(handle: string, reason: string): Promise<void> {
    this.active.get(handle)?.controller.abort();
    await this.db.query(
      `UPDATE worker_runtime_executions
       SET status='cancelled',failure_reason=$2,completed_at=now(),updated_at=now()
       WHERE runtime_handle=$1 AND status IN('starting','running')`,
      [handle, reason],
    );
  }

  async terminate(handle: string, reason: string): Promise<void> {
    this.active.get(handle)?.controller.abort();
    await this.db.query(
      `UPDATE worker_runtime_executions
       SET status='failed',failure_reason=$2,completed_at=now(),updated_at=now()
       WHERE runtime_handle=$1 AND status IN('starting','running')`,
      [handle, reason],
    );
  }

  private async execute(
    handle: string,
    request: ModelExecutionRequest,
    adapter: ModelExecutionAdapter,
    controller: AbortController,
  ): Promise<void> {
    let timedOut = false;
    const timer = request.boundaries.maxDurationMs
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, request.boundaries.maxDurationMs)
      : undefined;
    try {
      const prepared = await prepareModelCoordination(this.coordination, request);
      const response = await adapter.execute(prepared.request, {
        signal: controller.signal,
        coordination: prepared.channel,
      });
      const { result, spentUsd } = normalizeModelResponse(prepared.request, response);
      await applyModelCoordinationActions(prepared.channel, response);
      const status = result.status;
      const reason = status === "failed" ? result.failureReason ?? "model_execution_failed" : null;
      await this.db.query(
        `UPDATE worker_runtime_executions
         SET status=$2,result=$3::jsonb,failure_reason=$4,spent_usd=greatest(spent_usd,$5),
             completed_at=now(),updated_at=now()
         WHERE runtime_handle=$1 AND status='running'`,
        [handle, status, JSON.stringify(result), reason, spentUsd],
      );
    } catch (error) {
      const spentUsd = error instanceof ModelBudgetExceededError ? error.spentUsd : 0;
      const reason = timedOut
        ? "model_execution_timeout"
        : controller.signal.aborted
          ? "model_execution_cancelled"
          : error instanceof Error
            ? error.message
            : String(error);
      await this.db.query(
        `UPDATE worker_runtime_executions
         SET status='failed',failure_reason=$2,spent_usd=greatest(spent_usd,$3),
             completed_at=now(),updated_at=now()
         WHERE runtime_handle=$1 AND status='running'`,
        [handle, reason, spentUsd],
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async failUnknownInFlight(handle: string): Promise<void> {
    await this.db.query(
      `UPDATE worker_runtime_executions
       SET status='failed',failure_reason='runtime_restart_unknown_outcome',
           completed_at=now(),updated_at=now()
       WHERE runtime_handle=$1 AND status='running'`,
      [handle],
    );
  }

  private async loadExecution(handle: string): Promise<any> {
    const result = await this.db.query(
      `SELECT * FROM worker_runtime_executions WHERE runtime_handle=$1`,
      [handle],
    );
    if (result.rowCount !== 1) throw new Error("unknown_runtime_handle");
    return result.rows[0];
  }

  private async loadDurableWorker(id: string): Promise<any> {
    const result = await this.db.query(`SELECT * FROM sentient_workers WHERE id=$1`, [id]);
    if (result.rowCount !== 1) throw new Error("unknown_worker");
    return result.rows[0];
  }

  private assertIdentity(worker: SentientWorker, durable: any): void {
    const mismatched =
      durable.id !== worker.id ||
      durable.spawn_request_id !== worker.spawnRequestId ||
      durable.task_id !== worker.taskId ||
      durable.tenant !== worker.tenant ||
      durable.role !== worker.role ||
      Number(durable.attempt_count) !== worker.attemptCount ||
      durable.correlation_id !== worker.correlationId ||
      (durable.parent_worker_id ?? undefined) !== worker.parentWorkerId ||
      digest(durable.assignment) !== digest(worker.assignment);
    if (mismatched) throw new Error("worker_identity_boundary_violation");
    if (
      worker.repository &&
      (worker.repository.owner !== durable.repository_owner ||
        worker.repository.repo !== durable.repository_name)
    ) {
      throw new Error("worker_repository_boundary_violation");
    }
  }
}

function isTerminal(status: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

function digest(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
