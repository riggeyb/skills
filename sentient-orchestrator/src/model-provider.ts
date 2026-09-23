export type ModelCapability =
  | "planning"
  | "coding.fast"
  | "coding.deep"
  | "testing"
  | "review.general"
  | "review.security"
  | "summarization";

export interface ModelDescriptor {
  provider: string;
  model: string;
  capabilities: ModelCapability[];
  inputCostPerMillionMicroUsd: number;
  outputCostPerMillionMicroUsd: number;
  qualityScore: number;
  latencyScore: number;
  contextTokens: number;
  enabled: boolean;
  metadata?: Record<string, unknown>;
}

export interface ModelRequest {
  capability: ModelCapability;
  input: string;
  system?: string;
  maxOutputTokens?: number;
  metadata?: Record<string, unknown>;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ModelResponse {
  text: string;
  usage: ModelUsage;
  finishReason?: string;
  raw?: unknown;
}

export interface ModelProvider {
  readonly name: string;
  generate(model: string, request: ModelRequest): Promise<ModelResponse>;
}

export class ModelProviderRegistry {
  private readonly providers = new Map<string, ModelProvider>();

  register(provider: ModelProvider): void {
    if (this.providers.has(provider.name)) {
      throw new Error(`Model provider ${provider.name} is already registered`);
    }
    this.providers.set(provider.name, provider);
  }

  get(name: string): ModelProvider {
    const provider = this.providers.get(name);
    if (!provider) throw new Error(`Unknown model provider ${name}`);
    return provider;
  }
}

export interface SentientProviderResponse {
  text: string;
  usage: { input_tokens: number; output_tokens: number };
  finish_reason?: string;
}

export class SentientHttpModelProvider implements ModelProvider {
  constructor(
    public readonly name: string,
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly timeoutMs = 120_000,
  ) {}

  async generate(model: string, request: ModelRequest): Promise<ModelResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/v1/generate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": "sentient-orchestrator",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          capability: request.capability,
          input: request.input,
          system: request.system,
          max_output_tokens: request.maxOutputTokens,
          metadata: request.metadata ?? {},
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `Provider ${this.name} failed with ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
        );
      }

      const body = (await response.json()) as SentientProviderResponse;
      if (typeof body.text !== "string" || !body.usage) {
        throw new Error(`Provider ${this.name} returned an invalid response`);
      }
      return {
        text: body.text,
        usage: {
          inputTokens: Number(body.usage.input_tokens ?? 0),
          outputTokens: Number(body.usage.output_tokens ?? 0),
        },
        finishReason: body.finish_reason,
        raw: body,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function calculateModelCostMicroUsd(
  descriptor: ModelDescriptor,
  usage: ModelUsage,
): number {
  const input = (usage.inputTokens * descriptor.inputCostPerMillionMicroUsd) / 1_000_000;
  const output = (usage.outputTokens * descriptor.outputCostPerMillionMicroUsd) / 1_000_000;
  return Math.ceil(input + output);
}
