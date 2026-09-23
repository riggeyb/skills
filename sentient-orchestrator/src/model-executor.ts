import type { Pool } from "pg";
import {
  calculateModelCostMicroUsd,
  type ModelCapability,
  type ModelDescriptor,
  type ModelProviderRegistry,
  type ModelRequest,
  type ModelResponse,
} from "./model-provider.js";
import { CapabilityModelRouter } from "./model-routing.js";

export interface ModelCallRecorder {
  success(input: {
    taskId?: string;
    agentRole?: string;
    descriptor: ModelDescriptor;
    capability: ModelCapability;
    response: ModelResponse;
    latencyMs: number;
  }): Promise<void>;
  failure(input: {
    taskId?: string;
    agentRole?: string;
    descriptor: ModelDescriptor;
    capability: ModelCapability;
    error: string;
    latencyMs: number;
  }): Promise<void>;
}

export class PostgresModelCallRecorder implements ModelCallRecorder {
  constructor(private readonly pool: Pool) {}

  async success(input: {
    taskId?: string;
    agentRole?: string;
    descriptor: ModelDescriptor;
    capability: ModelCapability;
    response: ModelResponse;
    latencyMs: number;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO model_calls(
         task_id, agent_role, provider, model, capability, status,
         input_tokens, output_tokens, cost_microusd, latency_ms
       )
       VALUES ($1, $2, $3, $4, $5, 'succeeded', $6, $7, $8, $9)`,
      [
        input.taskId ?? null,
        input.agentRole ?? null,
        input.descriptor.provider,
        input.descriptor.model,
        input.capability,
        input.response.usage.inputTokens,
        input.response.usage.outputTokens,
        calculateModelCostMicroUsd(input.descriptor, input.response.usage),
        input.latencyMs,
      ],
    );
  }

  async failure(input: {
    taskId?: string;
    agentRole?: string;
    descriptor: ModelDescriptor;
    capability: ModelCapability;
    error: string;
    latencyMs: number;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO model_calls(
         task_id, agent_role, provider, model, capability, status, error, latency_ms
       )
       VALUES ($1, $2, $3, $4, $5, 'failed', $6, $7)`,
      [
        input.taskId ?? null,
        input.agentRole ?? null,
        input.descriptor.provider,
        input.descriptor.model,
        input.capability,
        input.error,
        input.latencyMs,
      ],
    );
  }
}

export class ModelExecutor {
  constructor(
    private readonly router: CapabilityModelRouter,
    private readonly providers: ModelProviderRegistry,
    private readonly recorder?: ModelCallRecorder,
  ) {}

  async generate(
    request: ModelRequest,
    options: {
      taskId?: string;
      agentRole?: string;
      minimumQuality?: number;
      preferredProvider?: string;
    } = {},
  ): Promise<{ response: ModelResponse; model: ModelDescriptor }> {
    const candidates = await this.router.candidates({
      capability: request.capability,
      minimumQuality: options.minimumQuality,
      preferredProvider: options.preferredProvider,
    });
    if (candidates.length === 0) {
      throw new Error(`No healthy model supports capability ${request.capability}`);
    }

    const failures: string[] = [];
    for (const descriptor of candidates) {
      const startedAt = Date.now();
      try {
        const provider = this.providers.get(descriptor.provider);
        const response = await provider.generate(descriptor.model, request);
        const latencyMs = Date.now() - startedAt;
        this.router.reportSuccess(descriptor);
        await this.recorder?.success({
          taskId: options.taskId,
          agentRole: options.agentRole,
          descriptor,
          capability: request.capability,
          response,
          latencyMs,
        });
        return { response, model: descriptor };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const latencyMs = Date.now() - startedAt;
        failures.push(`${descriptor.provider}/${descriptor.model}: ${message}`);
        this.router.reportFailure(descriptor);
        await this.recorder?.failure({
          taskId: options.taskId,
          agentRole: options.agentRole,
          descriptor,
          capability: request.capability,
          error: message,
          latencyMs,
        });
      }
    }

    throw new Error(
      `All candidate models failed for ${request.capability}: ${failures.join(" | ")}`,
    );
  }
}
