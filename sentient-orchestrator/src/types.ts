export type AgentRole = "planner" | "backend" | "frontend" | "tests" | "reviewer";
export type TaskStatus = "queued" | "planning" | "running" | "reviewing" | "completed" | "failed";
export type AgentStatus = "queued" | "running" | "completed" | "failed";
export type ModelTier = "economy" | "balanced" | "premium";

export interface RepositoryRef {
  owner: string;
  repo: string;
}

export interface TaskOrigin {
  repository: RepositoryRef;
  issueNumber: number;
  installationId: number;
  deliveryId: string;
  requestedBy: string;
}

export interface AgentState {
  role: AgentRole;
  status: AgentStatus;
  summary?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface TaskMessage {
  id: string;
  taskId: string;
  role: AgentRole | "system";
  body: string;
  createdAt: string;
}

export interface Task {
  id: string;
  objective: string;
  status: TaskStatus;
  origin: TaskOrigin;
  agents: AgentState[];
  messages: TaskMessage[];
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface AgentContext {
  task: Task;
  role: AgentRole;
  modelTier: ModelTier;
  readMessages(): Promise<TaskMessage[]>;
  sendMessage(body: string): Promise<void>;
}

export interface AgentResult {
  summary: string;
}

export interface Agent {
  role: AgentRole;
  run(context: AgentContext): Promise<AgentResult>;
}

export interface ProgressEvent {
  task: Task;
  headline: string;
  detail?: string;
}

export interface ProgressSink {
  publish(event: ProgressEvent): Promise<void>;
}
