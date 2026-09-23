import type { Agent, AgentContext, AgentResult, AgentRole } from "./types.js";

class DemoAgent implements Agent {
  constructor(public readonly role: AgentRole) {}

  async run(context: AgentContext): Promise<AgentResult> {
    const previous = await context.readMessages();
    await context.sendMessage(
      `${this.role} started on ${context.modelTier} tier with ${previous.length} shared messages available.`,
    );

    const summary = this.summaryFor(context.task.objective);
    await context.sendMessage(summary);
    return { summary };
  }

  private summaryFor(objective: string): string {
    switch (this.role) {
      case "planner":
        return `Plan: decompose "${objective}" into implementation, tests, and review workstreams.`;
      case "backend":
        return "Backend workstream completed its assigned implementation pass.";
      case "frontend":
        return "Frontend workstream completed its assigned implementation pass.";
      case "tests":
        return "Test workstream completed its validation pass.";
      case "reviewer":
        return "Reviewer inspected shared agent reports and completed the integration review.";
    }
  }
}

export function createDemoAgents(): Agent[] {
  return ["planner", "backend", "frontend", "tests", "reviewer"].map(
    (role) => new DemoAgent(role as AgentRole),
  );
}
