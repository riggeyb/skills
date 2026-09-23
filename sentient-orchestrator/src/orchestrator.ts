import type { Agent, AgentRole, ProgressEvent, ProgressSink, Task, TaskOrigin } from "./types.js";
import type { TaskStore } from "./ports.js";
import { ModelRouter } from "./model-router.js";

const PARALLEL_ROLES: AgentRole[] = ["backend", "frontend", "tests"];

export class Orchestrator {
  private readonly agents: Map<AgentRole, Agent>;

  constructor(
    private readonly store: TaskStore,
    agentList: Agent[],
    private readonly router: ModelRouter,
    private readonly progress: ProgressSink,
  ) {
    this.agents = new Map(agentList.map((agent) => [agent.role, agent]));
  }

  async start(objective: string, origin: TaskOrigin): Promise<Task> {
    const roles: AgentRole[] = ["planner", ...PARALLEL_ROLES, "reviewer"];
    let task = await this.store.create(objective, origin, roles);

    if (task.status === "completed") {
      return task;
    }

    await this.publish({
      task,
      headline: task.status === "queued" ? "Task queued" : "Task resumed",
      detail: objective,
    });

    try {
      task = await this.store.updateStatus(task.id, "planning");
      await this.runAgent(task.id, "planner");

      task = await this.store.updateStatus(task.id, "running");
      await this.publish({
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

      task = await this.store.updateStatus(task.id, "reviewing");
      await this.runAgent(task.id, "reviewer");

      task = await this.store.updateStatus(task.id, "completed");
      await this.store.addMessage(task.id, "system", "All workstreams completed.");
      task = await this.store.get(task.id);
      await this.publish({ task, headline: "Task completed" });
      return task;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      task = await this.store.updateStatus(task.id, "failed", message);
      await this.publish({ task, headline: "Task failed", detail: message });
      return task;
    }
  }

  private async runAgent(taskId: string, role: AgentRole): Promise<void> {
    const agent = this.agents.get(role);
    if (!agent) throw new Error(`No agent registered for ${role}`);

    let task = await this.store.updateAgent(taskId, role, {
      status: "running",
      startedAt: new Date().toISOString(),
    });
    const modelTier = this.router.route(task, role);
    await this.publish({
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
          await this.store.addMessage(taskId, role, body);
        },
      });

      task = await this.store.updateAgent(taskId, role, {
        status: "completed",
        summary: result.summary,
        completedAt: new Date().toISOString(),
      });
      await this.publish({
        task,
        headline: `${role} completed`,
        detail: result.summary,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.store.updateAgent(taskId, role, {
        status: "failed",
        summary: message,
        completedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  private async publish(event: ProgressEvent): Promise<void> {
    try {
      await this.progress.publish(event);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[sentient] progress publish failed for task ${event.task.id}: ${message}`);
    }
  }
}
