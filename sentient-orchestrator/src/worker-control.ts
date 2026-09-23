export type WorkerStatus =
  | "pending"
  | "assigned"
  | "starting"
  | "running"
  | "blocked"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

export interface SpawnWorkerRequest {
  taskId: string;
  tenant: string;
  repository: { owner: string; repo: string };
  role: string;
  assignment: unknown;
  requiredCapabilities?: string[];
  preferredModelTier?: string;
  maxCostUsd?: number;
  maxDurationMs?: number;
  repositoryPermissions?: Record<string, unknown>;
  workspaceRequirement?: unknown;
  dependencies?: string[];
  parentWorkerId?: string;
  coordinatorId?: string;
  correlationId?: string;
  idempotencyKey: string;
  maxAttempts?: number;
}

export interface WorkerHandoff {
  handoffId: string;
  objective: string;
  completedWork: string[];
  filesCommitsArtifacts: unknown[];
  findings: string[];
  unresolvedQuestions: string[];
  dependencies: string[];
  testsResults: string[];
  risks: string[];
  recommendedNextAction: string;
}

export interface WorkerExecutionResult {
  status: "completed" | "failed";
  conclusion: string;
  evidence: unknown[];
  artifacts: unknown[];
  toolResults: unknown[];
  handoff: WorkerHandoff;
  failureReason?: string;
}

export interface SentientWorker {
  id: string;
  spawnRequestId: string;
  taskId: string;
  tenant: string;
  repository?: { owner: string; repo: string };
  role: string;
  assignment: unknown;
  status: WorkerStatus;
  runtimeId?: string;
  runtimeHandle?: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  lastHeartbeatAt?: string;
  attemptCount: number;
  budgetUsd?: number;
  spentUsd: number;
  parentWorkerId?: string;
  coordinatorId?: string;
  correlationId: string;
  capabilities?: string[];
  authority?: Record<string, unknown>;
  workspaceAssignment?: unknown;
  modelProviderRequirements?: Record<string, unknown>;
}

export interface RuntimeRequirements {
  capabilities: string[];
  preferredModelTier?: string;
  maxCostUsd?: number;
  maxDurationMs?: number;
  workspaceRequirement?: unknown;
}

export interface WorkerRuntimeState {
  status: string;
  spentUsd?: number;
  reason?: string;
  result?: WorkerExecutionResult;
}

export interface WorkerRuntime {
  readonly id: string;
  compatible(requirements: RuntimeRequirements): boolean;
  spawn(worker: SentientWorker, requirements: RuntimeRequirements): Promise<{ handle: string }>;
  assign(handle: string, assignment: unknown): Promise<void>;
  inspect(handle: string): Promise<WorkerRuntimeState>;
  cancel(handle: string, reason: string): Promise<void>;
  terminate(handle: string, reason: string): Promise<void>;
}

const TRANSITIONS: Record<WorkerStatus, WorkerStatus[]> = {
  pending: ["assigned", "cancelled", "failed"],
  assigned: ["starting", "cancelled", "failed"],
  starting: ["running", "failed", "cancelled", "expired"],
  running: ["blocked", "waiting", "completed", "failed", "cancelled", "expired"],
  blocked: ["running", "waiting", "failed", "cancelled", "expired"],
  waiting: ["running", "blocked", "completed", "failed", "cancelled", "expired"],
  completed: [],
  failed: [],
  cancelled: [],
  expired: [],
};

export function assertWorkerTransition(from: WorkerStatus, to: WorkerStatus) {
  if (!TRANSITIONS[from].includes(to)) throw new Error(`Illegal worker transition ${from} -> ${to}`);
}

export class RuntimeRegistry {
  constructor(private readonly runtimes: WorkerRuntime[]) {}

  select(requirements: RuntimeRequirements) {
    return this.runtimes.find((runtime) => runtime.compatible(requirements)) ?? null;
  }

  get(id: string) {
    return this.runtimes.find((runtime) => runtime.id === id) ?? null;
  }
}

export class DeterministicWorkerRuntime implements WorkerRuntime {
  readonly id = "deterministic";
  private readonly states = new Map<string, string>();

  constructor(private readonly capabilities: string[] = ["test"]) {}

  compatible(requirements: RuntimeRequirements) {
    return requirements.capabilities.every((capability) => this.capabilities.includes(capability));
  }

  async spawn(worker: SentientWorker) {
    const handle = `det:${worker.id}`;
    this.states.set(handle, "starting");
    return { handle };
  }

  async assign(handle: string, _assignment: unknown) {
    if (!this.states.has(handle)) throw new Error("unknown runtime handle");
    this.states.set(handle, "running");
  }

  async inspect(handle: string): Promise<WorkerRuntimeState> {
    return { status: this.states.get(handle) ?? "failed" };
  }

  async cancel(handle: string, _reason: string) {
    this.states.set(handle, "cancelled");
  }

  async terminate(handle: string, _reason: string) {
    this.states.set(handle, "failed");
  }
}
