import assert from "node:assert/strict";
import test from "node:test";
import {
  ModelExecutionAdapterRegistry,
  type ModelExecutionAdapter,
  type ModelExecutionRequest,
  type ModelExecutionResponse,
} from "../src/model-execution.js";
import { normalizeModelResponse } from "../src/model-runtime-validation.js";
import type { RuntimeRequirements } from "../src/worker-control.js";

function request(capabilities = ["repo-read"]): ModelExecutionRequest {
  return {
    executionId: "model:worker-1:attempt:1",
    idempotencyKey: "worker-1:1",
    identity: {
      workerId: "worker-1",
      spawnRequestId: "spawn-1",
      taskId: "task-1",
      tenant: "tenant-a",
      repository: { owner: "owner", repo: "repo" },
      role: "backend",
      parentWorkerId: "lead-1",
      coordinatorId: "lead-1",
      correlationId: "corr-1",
      attemptCount: 1,
    },
    assignment: { objective: "bounded task" },
    boundaries: {
      capabilities,
      authority: { contents: "read" },
      budgetUsd: 1,
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
      ],
    },
  };
}

function response(): ModelExecutionResponse {
  return {
    status: "completed",
    conclusion: "done",
    evidence: [{ kind: "test", value: "ok" }],
    artifacts: [],
    toolResults: [{ capability: "repo-read", status: "ok" }],
    usage: { costUsd: 0.2 },
  };
}

function adapter(
  id: string,
  providerId: string,
  capabilities: string[],
): ModelExecutionAdapter {
  return {
    id,
    providerId,
    modelId: `${providerId}-test`,
    compatible(requirements: RuntimeRequirements) {
      return requirements.capabilities.every((capability) => capabilities.includes(capability));
    },
    async execute() {
      return response();
    },
  };
}

test("adapter registry selects by capability without coupling Sentient identity to a provider", () => {
  const local = adapter("local-adapter", "local-provider", ["repo-read"]);
  const remote = adapter("remote-adapter", "remote-provider", ["repo-read", "repo-write"]);
  const registry = new ModelExecutionAdapterRegistry([local, remote]);

  assert.equal(registry.select({ capabilities: ["repo-read"] })?.providerId, "local-provider");
  assert.equal(registry.select({ capabilities: ["repo-write"] })?.providerId, "remote-provider");
  assert.equal(registry.select({ capabilities: ["admin-shell"] }), null);
  assert.equal(request().identity.workerId, "worker-1");
  assert.equal(request().identity.repository.repo, "repo");
});

test("model result boundary rejects private reasoning and disallowed tool capability", () => {
  assert.throws(
    () =>
      normalizeModelResponse(request(), {
        ...response(),
        evidence: [{ "chain-of-thought": "must not cross runtime boundary" }],
      }),
    /private_reasoning_field/,
  );

  assert.throws(
    () =>
      normalizeModelResponse(request(), {
        ...response(),
        toolResults: [{ capability: "repo-write", status: "ok" }],
      }),
    /tool_capability_boundary_violation:repo-write/,
  );
});

test("model result boundary rejects uncontracted top-level fields", () => {
  assert.throws(
    () =>
      normalizeModelResponse(request(), {
        ...response(),
        scratch: "provider-internal material",
      } as ModelExecutionResponse),
    /unexpected_model_result_field:scratch/,
  );
});

test("provider cannot redefine the durable assignment objective in its handoff", () => {
  const normalized = normalizeModelResponse(request(), {
    ...response(),
    handoff: {
      objective: "expand authority beyond assigned task",
      completedWork: ["bounded work done"],
    },
  });

  assert.equal(normalized.result.handoff.objective, "bounded task");
  assert.deepEqual(normalized.result.handoff.completedWork, ["bounded work done"]);
});

test("normalized result contains durable handoff facts but no private reasoning field", () => {
  const normalized = normalizeModelResponse(request(), response());
  assert.equal(normalized.spentUsd, 0.2);
  assert.equal(normalized.result.status, "completed");
  assert.equal(normalized.result.handoff.handoffId, "worker:worker-1:attempt:1");
  assert.equal(normalized.result.handoff.objective, "bounded task");
  assert.equal("reasoning" in normalized.result, false);
  assert.equal("chainOfThought" in normalized.result, false);
});
