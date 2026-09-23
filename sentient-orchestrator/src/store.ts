import { randomUUID } from "node:crypto";
import type { AgentRole, AgentState, Task, TaskMessage, TaskOrigin, TaskStatus } from "./types.js";
import type { TaskStore } from "./ports.js";

export class InMemoryTaskStore implements TaskStore {
  private readonly tasks = new Map<string, Task>();
  private readonly deliveries = new Set<string>();
  private readonly taskByDelivery = new Map<string, string>();

  async claimDelivery(deliveryId: string): Promise<boolean> {
    if (this.deliveries.has(deliveryId)) return false;
    this.deliveries.add(deliveryId);
    return true;
  }

  async create(objective: string, origin: TaskOrigin, roles: AgentRole[]): Promise<Task> {
    const existingId = this.taskByDelivery.get(origin.deliveryId);
    if (existingId) return this.get(existingId);

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
    this.taskByDelivery.set(origin.deliveryId, task.id);
    return structuredClone(task);
  }

  async get(taskId: string): Promise<Task> {
    const task = this.require(taskId);
    return structuredClone(task);
  }

  async updateStatus(taskId: string, status: TaskStatus, error?: string): Promise<Task> {
    const task = this.require(taskId);
    task.status = status;
    task.error = error;
    task.updatedAt = new Date().toISOString();
    return structuredClone(task);
  }

  async updateAgent(taskId: string, role: AgentRole, patch: Partial<AgentState>): Promise<Task> {
    const task = this.require(taskId);
    const agent = task.agents.find((entry) => entry.role === role);
    if (!agent) throw new Error(`Task ${taskId} has no ${role} agent`);
    Object.assign(agent, patch);
    task.updatedAt = new Date().toISOString();
    return structuredClone(task);
  }

  async addMessage(taskId: string, role: AgentRole | "system", body: string): Promise<TaskMessage> {
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

  async messages(taskId: string): Promise<TaskMessage[]> {
    return (await this.get(taskId)).messages;
  }

  private require(taskId: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Unknown task ${taskId}`);
    return task;
  }
}
