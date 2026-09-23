import assert from "node:assert/strict";
import test from "node:test";
import {
  ModelProviderRegistry,
  type ModelDescriptor,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
} from "../src/model-provider.js";
import { InMemoryModelCatalog, CapabilityModelRouter } from "../src/model-routing.js";
import { ModelExecutor } from "../src/model-executor.js";
import { parsePlanJson } from "../src/model-planner.js";

const descriptors: ModelDescriptor[] = [
  {
    provider: "cheap",
    model: "cheap-code",
    capabilities: ["coding.deep", "planning"],
    inputCostPerMillionMicroUsd: 100,
    outputCostPerMillionMicroUsd: 200,
    qualityScore: 0.72,
    latencyScore: 0.9,
    contextTokens: 100_000,
    enabled: true,
  },
  {
    provider: "strong",
    model: "strong-code",
    capabilities: ["coding.deep", "planning"],
    inputCostPerMillionMicroUsd: 800,
    outputCostPerMillionMicroUsd: 1200,
    qualityScore: 0.95,
    latencyScore: 0.7,
    contextTokens: 200_000,
    enabled: true,
  },
];

class FakeProvider implements ModelProvider {
  constructor(
    public readonly name: string,
    private readonly handler: (model: string, request: ModelRequest) => Promise<ModelResponse>,
  ) {}

  generate(model: string, request: ModelRequest): Promise<ModelResponse> {
    return this.handler(model, request);
  }
}

test("model executor falls back to the next healthy provider", async () => {
  const registry = new ModelProviderRegistry();
  registry.register(
    new FakeProvider("cheap", async () => {
      throw new Error("provider unavailable");
    }),
  );
  registry.register(
    new FakeProvider("strong", async () => ({
      text: "working result",
      usage: { inputTokens: 100, outputTokens: 50 },
    })),
  );

  const router = new CapabilityModelRouter(new InMemoryModelCatalog(descriptors), {
    qualityWeight: 0.45,
    costWeight: 0.45,
    latencyWeight: 0.1,
    failureThreshold: 2,
    cooldownMs: 60_000,
  });
  const executor = new ModelExecutor(router, registry);

  const result = await executor.generate({
    capability: "coding.deep",
    input: "Fix the bug",
  });

  assert.equal(result.model.provider, "strong");
  assert.equal(result.response.text, "working result");
});

test("minimum quality excludes cheaper models below threshold", async () => {
  const router = new CapabilityModelRouter(new InMemoryModelCatalog(descriptors));
  const candidates = await router.candidates({
    capability: "coding.deep",
    minimumQuality: 0.9,
  });
  assert.deepEqual(
    candidates.map((candidate) => `${candidate.provider}/${candidate.model}`),
    ["strong/strong-code"],
  );
});

test("planner JSON parser strips fences and validates normalized nodes", () => {
  const plan = parsePlanJson(`
\`\`\`json
{
  "nodes": [
    {"key":"api","role":"backend","objective":"Build API","dependsOn":[],"priority":5},
    {"key":"review","role":"reviewer","objective":"Review","dependsOn":["api"]}
  ]
}
\`\`\`
  `);

  assert.equal(plan.nodes.length, 2);
  assert.deepEqual(plan.nodes[1]?.dependsOn, ["api"]);
  assert.equal(plan.nodes[1]?.priority, 0);
});
