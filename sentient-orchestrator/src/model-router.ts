import type { AgentRole, ModelTier, Task } from "./types.js";

export interface ModelRoutingPolicy {
  premiumReview: boolean;
  economyPlanningMaxChars: number;
}

export class ModelRouter {
  constructor(
    private readonly policy: ModelRoutingPolicy = {
      premiumReview: true,
      economyPlanningMaxChars: 280,
    },
  ) {}

  route(task: Task, role: AgentRole): ModelTier {
    if (role === "reviewer") return this.policy.premiumReview ? "premium" : "balanced";
    if (role === "planner" && task.objective.length <= this.policy.economyPlanningMaxChars) {
      return "economy";
    }
    if (role === "tests") return "economy";
    return "balanced";
  }
}
