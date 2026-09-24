import type { ModelExecutionRequest, ModelExecutionResponse } from "./model-execution.js";
import type { WorkerExecutionResult, WorkerHandoff } from "./worker-control.js";

const PRIVATE_REASONING_KEYS = new Set([
  "reasoning",
  "analysis",
  "scratchpad",
  "internalreasoning",
  "internal_reasoning",
  "chainofthought",
  "chain_of_thought",
  "thoughts",
]);

const MODEL_RESULT_KEYS = new Set([
  "status",
  "conclusion",
  "evidence",
  "artifacts",
  "toolResults",
  "handoff",
  "failureReason",
  "usage",
  "coordinationActions",
]);

export interface NormalizedModelResult {
  result: WorkerExecutionResult;
  spentUsd: number;
}

export function normalizeModelResponse(
  request: ModelExecutionRequest,
  response: ModelExecutionResponse,
): NormalizedModelResult {
  assertResponseShape(response);
  rejectPrivateReasoning(response);
  if (response.status !== "completed" && response.status !== "failed") {
    throw new Error("invalid_model_result_status");
  }
  if (typeof response.conclusion !== "string" || response.conclusion.trim().length === 0) {
    throw new Error("invalid_model_result_conclusion");
  }

  const evidence = requireArray(response.evidence, "evidence");
  const artifacts = requireArray(response.artifacts, "artifacts");
  const toolResults = requireArray(response.toolResults, "toolResults");
  assertToolCapabilities(request.boundaries.capabilities, toolResults);

  const spentUsd = response.usage?.costUsd ?? 0;
  if (!Number.isFinite(spentUsd) || spentUsd < 0) throw new Error("invalid_model_usage_cost");
  if (request.boundaries.budgetUsd !== undefined && spentUsd > request.boundaries.budgetUsd) {
    throw new ModelBudgetExceededError(spentUsd);
  }

  const supplied = response.handoff ?? {};
  const handoff: WorkerHandoff = {
    handoffId: `worker:${request.identity.workerId}:attempt:${request.identity.attemptCount}`,
    objective: assignmentObjective(request.assignment),
    completedWork: stringArray(supplied.completedWork, [response.conclusion]),
    filesCommitsArtifacts: Array.isArray(supplied.filesCommitsArtifacts)
      ? supplied.filesCommitsArtifacts
      : artifacts,
    findings: stringArray(supplied.findings),
    unresolvedQuestions: stringArray(supplied.unresolvedQuestions),
    dependencies: stringArray(supplied.dependencies),
    testsResults: stringArray(supplied.testsResults),
    risks: stringArray(supplied.risks),
    recommendedNextAction:
      typeof supplied.recommendedNextAction === "string" && supplied.recommendedNextAction.length
        ? supplied.recommendedNextAction
        : "lead review",
  };

  const result: WorkerExecutionResult = {
    status: response.status,
    conclusion: response.conclusion,
    evidence,
    artifacts,
    toolResults,
    handoff,
    failureReason:
      typeof response.failureReason === "string" && response.failureReason.length
        ? response.failureReason
        : undefined,
  };
  return { result, spentUsd };
}

export class ModelBudgetExceededError extends Error {
  constructor(readonly spentUsd: number) {
    super("budget_exceeded_by_provider");
  }
}

function assertResponseShape(response: ModelExecutionResponse): void {
  for (const key of Object.keys(response)) {
    if (!MODEL_RESULT_KEYS.has(key)) {
      throw new Error(`unexpected_model_result_field:${key}`);
    }
  }
}

function assertToolCapabilities(allowed: string[], toolResults: unknown[]): void {
  for (const item of toolResults) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const capability = (item as { capability?: unknown }).capability;
    if (typeof capability === "string" && !allowed.includes(capability)) {
      throw new Error(`tool_capability_boundary_violation:${capability}`);
    }
  }
}

function rejectPrivateReasoning(value: unknown): void {
  if (Array.isArray(value)) {
    for (const child of value) rejectPrivateReasoning(child);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.replace(/[-\s]/g, "").toLowerCase();
    if (PRIVATE_REASONING_KEYS.has(normalized) || PRIVATE_REASONING_KEYS.has(key.toLowerCase())) {
      throw new Error(`private_reasoning_field:${key}`);
    }
    rejectPrivateReasoning(child);
  }
}

function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`invalid_model_result_${field}`);
  return value;
}

function stringArray(value: unknown, fallback: string[] = []): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : fallback;
}

function assignmentObjective(assignment: unknown): string {
  if (assignment && typeof assignment === "object" && !Array.isArray(assignment)) {
    const objective = (assignment as { objective?: unknown }).objective;
    if (typeof objective === "string" && objective.length) return objective;
  }
  return "assigned worker task";
}
