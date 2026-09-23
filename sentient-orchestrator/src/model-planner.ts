import type { ModelExecutor } from "./model-executor.js";
import { validateTaskPlan, type TaskPlan } from "./task-graph.js";

export class ModelTaskPlanner {
  constructor(
    private readonly models: ModelExecutor,
    private readonly minimumQuality = 0.55,
  ) {}

  async plan(input: {
    taskId: string;
    objective: string;
    repository?: { owner: string; repo: string };
  }): Promise<TaskPlan> {
    const response = await this.models.generate(
      {
        capability: "planning",
        system: [
          "You are Sentient's task planner.",
          "Return only JSON with this shape:",
          '{"nodes":[{"key":"short-id","role":"worker-role","objective":"specific work","dependsOn":["other-id"],"priority":0}]}',
          "Create the smallest useful acyclic plan.",
          "Independent work should not depend on each other so it can run in parallel.",
          "Every dependency must reference another node key in the same plan.",
          "Use a final reviewer/integrator node when multiple implementation nodes need synthesis.",
        ].join("\n"),
        input: JSON.stringify({
          objective: input.objective,
          repository: input.repository,
        }),
        maxOutputTokens: 2500,
        metadata: {
          taskId: input.taskId,
          purpose: "task-plan",
        },
      },
      {
        taskId: input.taskId,
        agentRole: "planner",
        minimumQuality: this.minimumQuality,
      },
    );

    return validateTaskPlan(parsePlanJson(response.response.text));
  }
}

export function parsePlanJson(text: string): TaskPlan {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("Planner did not return a JSON object");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(withoutFence.slice(firstBrace, lastBrace + 1));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Planner returned invalid JSON: ${message}`);
  }

  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { nodes?: unknown }).nodes)) {
    throw new Error("Planner JSON must contain a nodes array");
  }

  const nodes = (parsed as { nodes: unknown[] }).nodes.map((raw, index) => {
    if (!raw || typeof raw !== "object") {
      throw new Error(`Planner node ${index} must be an object`);
    }
    const node = raw as Record<string, unknown>;
    const key = typeof node.key === "string" ? node.key.trim() : "";
    const role = typeof node.role === "string" ? node.role.trim() : "";
    const objective = typeof node.objective === "string" ? node.objective.trim() : "";
    const dependsOn = Array.isArray(node.dependsOn)
      ? node.dependsOn.map((value) => String(value).trim()).filter(Boolean)
      : [];
    const priority =
      typeof node.priority === "number" && Number.isFinite(node.priority)
        ? Math.trunc(node.priority)
        : 0;

    return { key, role, objective, dependsOn, priority };
  });

  return { nodes };
}
