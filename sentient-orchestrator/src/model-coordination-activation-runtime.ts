import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type {
  RuntimeRequirements,
  SentientWorker,
  WorkerActivationRequest,
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
import type { SentientCoordinationService } from "./sentient-coordination.js";

interface ActiveExecution {
  controller: AbortController;
  promise: Promise<void>;
}

export class ModelCoordinationActivationRuntime {
  private readonly active = new Map<string, ActiveExecution>();

  constructor(
    private readonly db: Pool,
    private readonly adapters: ModelExecutionAdapterRegistry,
    private readonly coordination?: SentientCoordinationService,
  ) {}

  owns(handle: string): boolean {
    return handle.startsWith("model:") && handle.includes(":coord:");
  }

  async activate(
    worker: SentientWorker,
    requirements: RuntimeRequirements,
    activation: WorkerActivationRequest,
  ): Promise<{ handle: string }> {
    const adapter = this.adapters.select(requirements);
    if (!adapter) throw new Error("no_compatible_model_adapter");

    const durable = await this.loadDurableWorker(worker.id);
    this.assertIdentity(worker, durable);
    if (!["waiting", "blocked"].includes(durable.status)) {
      throw new Error(`coordination_worker_not_idle:${durable.status}`);
    }

    const capabilities = stringArray(durable.capabilities);
    if (!requirements.capabilities.every((capability) => capabilities.includes(capability))) {
      throw new Error("worker_capability_boundary_violation");
    }

    const totalBudgetUsd = durable.budget_usd == null ? undefined : Number(durable.budget_usd);
    const alreadySpentUsd = Number(durable.spent_usd ?? 0);
    const remainingBudgetUsd =
      totalBudgetUsd === undefined ? undefined : Math.max(totalBudgetUsd - alreadySpentUsd, 0);
    const turnBudgetUsd = minimumDefined(remainingBudgetUsd, requirements.maxCostUsd);
    if (turnBudgetUsd !== undefined && !(turnBudgetUsd > 0)) {
      throw new Error("coordination_budget_exhausted");
    }

    const handle =
      `model:${worker.id}:coord:${activation.activationId}:attempt:${activation.activationAttempt}`;
    const request: ModelExecutionRequest = {
      executionId: handle,
      idempotencyKey: `${activation.activationId}:${activation.activationAttempt}`,
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
      coordinationActivation: activation,
      boundaries: {
        capabilities,
        authority: objectValue(durable.authority),
        workspace: durable.workspace_assignment ?? undefined,
        budgetUsd: turnBudgetUsd,
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
      `INSERT INTO worker_coordination_runtime_executions(
         runtime_handle,activation_id,worker_id,execution_attempt,runtime_id,
         adapter_id,provider_id,model_id,request,request_hash,assignment_hash,status
       )
       VALUES($1,$2,$3,$4,'model-backed',$5,$6,$7,$8::jsonb,$9,$10,'starting')
       ON CONFLICT(activation_id,execution_attempt) DO NOTHING`,
      [
        handle,
        activation.activationId,
        worker.id,
        activation.activationAttempt,
        adapter.id,
        adapter.providerId,
        adapter.modelId ?? null,
        JSON.stringify(request),
        requestHash,
        assignmentHash,
      ],
    );

    let execution = await this.loadExecution(handle);
    if (
      execution.activation_id !== activation.activationId ||
      execution.worker_id !== worker.id ||
      Number(execution.execution_attempt) !== activation.activationAttempt ||
      execution.runtime_id !== "model-backed" ||
      execution.adapter_id !== adapter.id ||
      execution.request_hash !== requestHash ||
      execution.assignment_hash !== assignmentHash
    ) {
      throw new Error("coordination_runtime_execution_identity_conflict");
    }

    if (isTerminal(execution.status)) return { handle };
    if (execution.status === "running") {
      if (this.active.has(handle)) return { handle };
      await this.failUnknownInFlight(handle);
      throw new Error("runtime_restart_unknown_outcome");
    }

    await this.db.query(
      `UPDATE worker_coordination_runtime_executions
       SET status='running',started_at=coalesce(started_at,now()),updated_at=now()
       WHERE runtime_handle=$1 AND status='starting'`,
      [handle],
    );
    execution = await this.loadExecution(handle);

    const controller = new AbortController();
    const promise = this.execute(handle, execution.request, adapter, controller)
      .finally(() => this.active.delete(handle));
    this.active.set(handle, { controller, promise });
    return { handle };
  }

  async inspect(handle: string): Promise<WorkerRuntimeState> {
    let execution = await this.loadExecution(handle);
    if (
      (execution.status === "starting" || execution.status === "running") &&
      !this.active.has(handle)
    ) {
      await this.failUnkownInFlight(handle);
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
      `UPDATE worker_coordination_runtime_executions
       SET status='cancelled',failure_reason=$2,completed_at=now(),updated_at=now()
       WHERE runtime_handle=$1 AND status IN('starting','running')`,
      [handle, reason],
    );
  }

  async terminate(handle: string, reason: string): Promise<void> {
    this.active.get(handle)?.controller.abort();
    await this.db.query(
      `UPDATE worker_coordination_runtime_executions
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
        `UPDATE worker_coordination_runtime_executions
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
        `UPDATE worker_coordination_runtime_executions
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
      `UPDATE worker_coordination_runtime_executions
       SET status='failed',failure_reason='runtime_restart_unknown_outcome',
           completed_at=now(),updated_at=now()
       WHERE runtime_handle=$1 AND status='running'`,
      [handle],
    );
  }

  private async loadExecution(handle: string): Promise<any> {
    const result = await this.db.query(
      `SELECT * FROM worker_coordination_runtime_executions WHERE runtime_handle=$1`,
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

function minimumDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
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
