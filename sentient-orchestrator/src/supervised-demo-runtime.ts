import type { RuntimeRequirements, SentientWorker, WorkerRuntime } from "./worker-control.js";

export class SupervisedDemoRuntime implements WorkerRuntime {
  readonly id = "supervised-demo";
  private readonly states = new Map<string, string>();
  private readonly roles = new Map<string, string>();

  constructor(private readonly capabilities: string[] = ["lead-control", "demo-agent"]) {}

  compatible(requirements: RuntimeRequirements): boolean {
    return requirements.capabilities.every((capability) => this.capabilities.includes(capability));
  }

  async spawn(worker: SentientWorker): Promise<{ handle: string }> {
    const handle = `demo:${worker.role}:${worker.id}`;
    this.states.set(handle, "starting");
    this.roles.set(handle, worker.role);
    return { handle };
  }

  async assign(handle: string, _assignment: unknown): Promise<void> {
    const role = this.role(handle);
    this.states.set(handle, role === "lead" ? "running" : "completed");
  }

  async inspect(handle: string): Promise<{ status: string; spentUsd?: number; reason?: string }> {
    const state = this.states.get(handle);
    if (state) return { status: state, spentUsd: 0 };
    return { status: this.role(handle) === "lead" ? "running" : "completed", spentUsd: 0 };
  }

  async cancel(handle: string, _reason: string): Promise<void> {
    this.states.set(handle, "cancelled");
  }

  async terminate(handle: string, _reason: string): Promise<void> {
    this.states.set(handle, "failed");
  }

  private role(handle: string): string {
    const known = this.roles.get(handle);
    if (known) return known;
    const match = /^demo:([^:]+):/.exec(handle);
    if (!match) throw new Error(`Unknown demo runtime handle ${handle}`);
    return match[1];
  }
}
