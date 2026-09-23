import type { Pool } from "pg";
import type { ModelCapability, ModelDescriptor } from "./model-provider.js";

export interface ModelCatalog {
  list(capability: ModelCapability): Promise<ModelDescriptor[]>;
}

export class PostgresModelCatalog implements ModelCatalog {
  constructor(private readonly pool: Pool) {}

  async list(capability: ModelCapability): Promise<ModelDescriptor[]> {
    const result = await this.pool.query(
      `SELECT provider, model, capabilities,
              input_cost_per_million_microusd,
              output_cost_per_million_microusd,
              quality_score, latency_score,
              context_tokens, enabled, metadata
       FROM model_catalog
       WHERE enabled = true AND $1 = ANY(capabilities)`,
      [capability],
    );

    return result.rows.map((row) => ({
      provider: row.provider,
      model: row.model,
      capabilities: row.capabilities,
      inputCostPerMillionMicroUsd: Number(row.input_cost_per_million_microusd),
      outputCostPerMillionMicroUsd: Number(row.output_cost_per_million_microusd),
      qualityScore: Number(row.quality_score),
      latencyScore: Number(row.latency_score),
      contextTokens: Number(row.context_tokens),
      enabled: Boolean(row.enabled),
      metadata: row.metadata ?? {},
    }));
  }
}

export class InMemoryModelCatalog implements ModelCatalog {
  constructor(private readonly models: ModelDescriptor[]) {}

  async list(capability: ModelCapability): Promise<ModelDescriptor[]> {
    return this.models.filter(
      (model) => model.enabled && model.capabilities.includes(capability),
    );
  }
}

export interface RoutingPolicy {
  qualityWeight: number;
  costWeight: number;
  latencyWeight: number;
  failureThreshold: number;
  cooldownMs: number;
}

interface CircuitState {
  failures: number;
  openUntil?: number;
}

export class CapabilityModelRouter {
  private readonly circuits = new Map<string, CircuitState>();

  constructor(
    private readonly catalog: ModelCatalog,
    private readonly policy: RoutingPolicy = {
      qualityWeight: 0.6,
      costWeight: 0.25,
      latencyWeight: 0.15,
      failureThreshold: 3,
      cooldownMs: 30_000,
    },
  ) {}

  async candidates(input: {
    capability: ModelCapability;
    minimumQuality?: number;
    preferredProvider?: string;
  }): Promise<ModelDescriptor[]> {
    const now = Date.now();
    const candidates = (await this.catalog.list(input.capability))
      .filter((model) => model.qualityScore >= (input.minimumQuality ?? 0))
      .filter((model) => {
        const state = this.circuits.get(keyFor(model));
        return !state?.openUntil || state.openUntil <= now;
      });

    const maxCost = Math.max(
      1,
      ...candidates.map(
        (model) =>
          model.inputCostPerMillionMicroUsd + model.outputCostPerMillionMicroUsd,
      ),
    );

    return candidates.sort((a, b) => {
      return this.score(b, maxCost, input.preferredProvider) -
        this.score(a, maxCost, input.preferredProvider);
    });
  }

  reportSuccess(model: ModelDescriptor): void {
    this.circuits.delete(keyFor(model));
  }

  reportFailure(model: ModelDescriptor): void {
    const key = keyFor(model);
    const state = this.circuits.get(key) ?? { failures: 0 };
    state.failures += 1;
    if (state.failures >= this.policy.failureThreshold) {
      state.failures = 0;
      state.openUntil = Date.now() + this.policy.cooldownMs;
    }
    this.circuits.set(key, state);
  }

  private score(
    model: ModelDescriptor,
    maxCost: number,
    preferredProvider?: string,
  ): number {
    const cost =
      model.inputCostPerMillionMicroUsd + model.outputCostPerMillionMicroUsd;
    const preference = model.provider === preferredProvider ? 0.05 : 0;
    return (
      this.policy.qualityWeight * model.qualityScore +
      this.policy.latencyWeight * model.latencyScore -
      this.policy.costWeight * (cost / maxCost) +
      preference
    );
  }
}

function keyFor(model: ModelDescriptor): string {
  return `${model.provider}/${model.model}`;
}
