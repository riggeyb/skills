import type { AgentRole, AgentState, Task, TaskMessage, TaskOrigin, TaskStatus } from "./types.js";

export interface TaskStore {
  claimDelivery(deliveryId: string): Promise<boolean>;
  create(objective: string, origin: TaskOrigin, roles: AgentRole[]): Promise<Task>;
  get(taskId: string): Promise<Task>;
  updateStatus(taskId: string, status: TaskStatus, error?: string): Promise<Task>;
  updateAgent(taskId: string, role: AgentRole, patch: Partial<AgentState>): Promise<Task>;
  addMessage(taskId: string, role: AgentRole | "system", body: string): Promise<TaskMessage>;
  messages(taskId: string): Promise<TaskMessage[]>;
}

export interface TaskStartJob {
  type: "task.start";
  objective: string;
  origin: TaskOrigin;
}

export type SentientJobPayload = TaskStartJob;

export interface QueueJob<T = SentientJobPayload> {
  id: string;
  payload: T;
  attempts: number;
  maxAttempts: number;
  availableAt: string;
  leaseExpiresAt?: string;
}

export interface EnqueueOptions {
  idempotencyKey: string;
  priority?: number;
  maxAttempts?: number;
}

export interface JobQueue {
  enqueue(payload: SentientJobPayload, options: EnqueueOptions): Promise<{ accepted: boolean; jobId: string }>;
  lease(workerId: string, leaseMs: number): Promise<QueueJob | null>;
  complete(jobId: string, workerId: string): Promise<void>;
  fail(jobId: string, workerId: string, error: string): Promise<{ deadLettered: boolean; retryAt?: string }>;
  cancel(jobId: string): Promise<boolean>;
}
