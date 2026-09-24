import type {
  RuntimeRequirements,
  WorkerExecutionResult,
} from "./worker-control.js";

export interface ModelExecutionIdentity {
  workerId: string;
  spawnRequestId: string;
  taskId: string;
  tenant: string;
  repository: { owner: string; repo: string };
  role: string;
  parentWorkerId?: string;
  coordinatorId?: string;
  correlationId: string;
  attemptCount: number;
}

export interface ModelExecutionRequest {
  executionId: string;
  idempotencyKey: string;
  identity: ModelExecutionIdentity;
  assignment: unknown;
  boundaries: {
    capabilities: string[];
    authority: Record<string, unknown>;
    workspace?: unknown;
    budgetUsd?: number;
    maxDurationMs?: number;
  };
  responseContract: {
    version: "sentient-worker-result/v1";
    privateReasoningForbidden: true;
    fields: readonly [
      "status",
      "conclusion",
      "evidence",
      "artifacts",
      "toolResults",
      "handoff",
      "failureReason",
      "usage"
    ];
  };
}

export interface ModelExecutionUsage {
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ModelExecutionResponse extends Omit<WorkerExecutionResult, "handoff"> {
  handoff?: Partial<WorkerExecutionResult["handoff"]>;
  usage?: ModelExecutionUsage;
}

export interface ModelExecutionContext {
  signal: AbortSignal;
}

export interface ModelExecutionAdapter {
  readonly id: string;
  readonly providerId: string;
  readonly modelId?: string;
  compatible(requirements: RuntimeRequirements): boolean;
  execute(request: ModelExecutionRequest, context: ModelExecutionContext): Promise<ModelExecutionResponse>;
}

export class ModelExecutionAdapterRegistry {
  constructor(private readonly adapters: ModelExecutionAdapter[]) {}

  select(requirements: RuntimeRequirements): ModelExecutionAdapter | null {
    return this.adapters.find((adapter) => adapter.compatible(requirements)) ?? null;
  }

  get(id: string): ModelExecutionAdapter | null {
    return this.adapters.find((adapter) => adapter.id === id) ?? null;
  }
}

export interface HttpModelExecutionAdapterOptions {
  id: string;
  providerId: string;
  modelId?: string;
  endpoint: string;
  bearerToken?: string;
  headers?: Record<string, string>;
  capabilities: string[];
  modelTiers?: string[];
}

export class HttpModelExecutionAdapter implements ModelExecutionAdapter {
  readonly id: string;
  readonly providerId: string;
  readonly modelId?: string;

  constructor(private readonly options: HttpModelExecutionAdapterOptions) {
    this.id = options.id;
    this.providerId = options.providerId;
    this.modelId = options.modelId;
  }

  compatible(requirements: RuntimeRequirements): boolean {
    if (!requirements.capabilities.every((capability) => this.options.capabilities.includes(capability))) {
      return false;
    }
    if (
      requirements.preferredModelTier &&
      this.options.modelTiers?.length &&
      !this.options.modelTiers.includes(requirements.preferredModelTier)
    ) {
      return false;
    }
    return true;
  }

  async execute(
    request: ModelExecutionRequest,
    context: ModelExecutionContext,
  ): Promise<ModelExecutionResponse> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...this.options.headers,
    };
    if (this.options.bearerToken) headers.authorization = `Bearer ${this.options.bearerToken}`;

    const response = await fetch(this.options.endpoint, {
      method: "POST",
      headers,
      signal: context.signal,
      body: JSON.stringify({
        protocol: "sentient-model-execution/v1",
        provider: {
          id: this.providerId,
          modelId: this.modelId ?? null,
        },
        request,
      }),
    });
    if (!response.ok) {
      throw new Error(`model_provider_http_${response.status}`);
    }
    const value: unknown = await response.json();
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("model_provider_invalid_response");
    }
    return value as ModelExecutionResponse;
  }
}
