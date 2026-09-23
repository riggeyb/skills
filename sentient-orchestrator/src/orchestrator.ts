import type { Agent, AgentRole, ProgressSink, Task, TaskOrigin } from "./types.js";
import { InMemoryTaskStore } from "./store.js";
import { ModelRouter } from "./model-router.js";

const PARALLEL_ROLES: AgentRole[] = ["backend", "frontend", "tests"];

export class Orchestrator {
  private readonly agents: Map<AgentRole, Agent>;

  constructor(
    private readonly store: InMemoryTaskStore,
    agentList: Agent[],
    private readonly router: ModelRouter,
    private readonly progress: ProgressSink,
  ) {
    this.agents = new Map(agentList.map((agent) => [agent.role, agent]));
  }

  async start(objective: string, origin: TaskOrigin): Promise<Task> {
    if (!this.store.claimDelivery(origin.deliveryId)) {
      throw new Error(`Duplicate delivery ${origin.deliveryId}`);
    }

    const roles: AgentRole[] = ["planner", ...PARALLEL_ROLES, "reviewer"];
    let task = this.store.create(objective, origin, roles);
    await this.progress.publish({ task, headline: "Task queued", detail: objective });

    try {
      task = this.store.updateStatus(task.id, "planning");
      await this.runAgent(task.id, "planner");

      task = this.store.updateStatus(task.id, "running");
      await this.progress.publish({
        task,
        headline: "Parallel work started",
        detail: PARALLEL_ROLES.join(", "),
      });

      const results = await Promise.allSettled(
        PARALLEL_ROLES.map((role) => this.runAgent(task.id, role)),
      );
      const failed = results.filter((result) => result.status === "rejected");
      if (failed.length > 0) {
        throw new Error(`${failed.length} parallel workstream(s) failed`);
      }

      task = this.store.updateStatus(task.id, "reviewing");
      await this.runAgent(task.id, "reviewer");

      task = this.store.updateStatus(task.id, "completed");
      this.store.addMessage(task.id, "system", "All workstreams completed.");
      task = this.store.get(task.id);
      await this.progress.publish({ task, headline: "Task completed" });
      return task;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      task = this.store.updateStatus(task.id, "failed", message);
      await this.progress.publish({ task, headline: "Task failed", detail: message });
      return task;
    }
  }

  private async runAgent(taskId: string, role: AgentRole): Promise<void> {
    const agent = this.agents.get(role);
    if (!agent) throw new Error(`No agent registered for ${role}`);

    let task = this.store.updateAgent(taskId, role, {
      status: "running",
      startedAt: new Date().toISOString(),
    });
    const modelTier = this.router.route(task, role);
    await this.progress.publish({
      task,
      headline: `${role} started`,
      detail: `model tier: ${modelTier}`,
    });

    try {
      const result = await agent.run({
        task,
        role,
        modelTier,
        readMessages: async () => this.store.messages(taskId),
        sendMessage: async (body) => {
          this.store.addMessage(taskId, role, body);
        },
      });

      task = this.store.updateAgent(taskId, role, {
        status: "completed",
        summary: result.summary,
        completedAt: new Date().toISOString(),
      });
      await this.progress.publish({
        task,
        headline: `${role} completed`,
        detail: result.summary,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.updateAgent(taskId, role, {
        status: "failed",
        summary: message,
        completedAt: new Date().toISOString(),
      });
      throw error;
    }
  }
}
