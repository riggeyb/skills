import { randomUUID } from "node:crypto";
import type { AgentRole, AgentState, Task, TaskMessage, TaskOrigin, TaskStatus } from "./types.js";

export class InMemoryTaskStore {
  private readonly tasks = new Map<string, Task>();
  private readonly deliveries = new Set<string>();

  claimDelivery(deliveryId: string): boolean {
    if (this.deliveries.has(deliveryId)) return false;
    this.deliveries.add(deliveryId);
    return true;
  }

  create(objective: string, origin: TaskOrigin, roles: AgentRole[]): Task {
    const now = new Date().toISOString();
    const task: Task = {
      id: randomUUID(),
      objective,
      status: "queued",
      origin,
      agents: roles.map((role): AgentState => ({ role, status: "queued" })),
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(task.id, task);
    return structuredClone(task);
  }

  get(taskId: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Unknown task ${taskId}`);
    return structuredClone(task);
  }

  updateStatus(taskId: string, status: TaskStatus, error?: string): Task {
    const task = this.require(taskId);
    task.status = status;
    task.error = error;
    task.updatedAt = new Date().toISOString();
    return structuredClone(task);
  }

  updateAgent(taskId: string, role: AgentRole, patch: Partial<AgentState>): Task {
    const task = this.require(taskId);
    const agent = task.agents.find((entry) => entry.role === role);
    if (!agent) throw new Error(`Task ${taskId} has no ${role} agent`);
    Object.assign(agent, patch);
    task.updatedAt = new Date().toISOString();
    return structuredClone(task);
  }

  addMessage(taskId: string, role: AgentRole | "system", body: string): TaskMessage {
    const task = this.require(taskId);
    const message: TaskMessage = {
      id: randomUUID(),
      taskId,
      role,
      body,
      createdAt: new Date().toISOString(),
    };
    task.messages.push(message);
    task.updatedAt = message.createdAt;
    return structuredClone(message);
  }

  messages(taskId: string): TaskMessage[] {
    return this.get(taskId).messages;
  }

  private require(taskId: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Unknown task ${taskId}`);
    return task;
  }
}
