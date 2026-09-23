import { parse } from "yaml";
import type { SandboxRuntime, SandboxSecret } from "./sandbox.js";
import { RepositoryWorkspaceEngine } from "./workspace.js";

export interface ActionStep {
  name: string;
  run: string;
  env: Record<string, string>;
  timeoutMs?: number;
}

export interface ActionJob {
  key: string;
  image: string;
  needs: string[];
  steps: ActionStep[];
  cpuCores: number;
  memoryMb: number;
  diskMb: number;
  maxPids: number;
  timeoutMs: number;
  egressHosts: string[];
  maxAttempts: number;
}

export interface SentientWorkflow {
  version: 1;
  name: string;
  jobs: ActionJob[];
}

export type ActionJobStatus = "queued" | "running" | "completed" | "failed" | "skipped";

export interface ActionJobResult {
  jobKey: string;
  status: "completed" | "failed";
  attempts: number;
  summary: string;
  logs: string;
}

export interface ActionExecutionContext {
  installationId: number;
  repository: { owner: string; repo: string };
  taskId: string;
  cloneUrl: string;
  baseRef: string;
  secrets?: SandboxSecret[];
}

export interface ActionJobRunner {
  run(job: ActionJob, context: ActionExecutionContext): Promise<ActionJobResult>;
}

export interface ActionsExecutionResult {
  status: "completed" | "failed";
  jobs: Record<string, ActionJobResult | { jobKey: string; status: "skipped"; attempts: 0; summary: string; logs: "" }>;
}

export function parseSentientWorkflow(source: string): SentientWorkflow {
  const raw = asRecord(parse(source), "workflow");
  if (Number(raw.version) !== 1) throw new Error("Sentient workflow version must be 1");

  const name = stringValue(raw.name, "workflow.name");
  const jobsRaw = asRecord(raw.jobs, "workflow.jobs");
  const jobs = Object.entries(jobsRaw).map(([key, value]) => normalizeJob(key, value));
  if (jobs.length === 0) throw new Error("Sentient workflow requires at least one job");
  if (jobs.length > 64) throw new Error("Sentient workflow exceeds 64 jobs");

  const workflow: SentientWorkflow = { version: 1, name, jobs };
  validateWorkflowDag(workflow);
  return workflow;
}

export function validateWorkflowDag(workflow: SentientWorkflow): SentientWorkflow {
  const keys = new Set<string>();
  for (const job of workflow.jobs) {
    validateJobKey(job.key);
    if (keys.has(job.key)) throw new Error(`Duplicate action job ${job.key}`);
    keys.add(job.key);
  }

  for (const job of workflow.jobs) {
    for (const dependency of job.needs) {
      if (!keys.has(dependency)) {
        throw new Error(`Action job ${job.key} needs unknown job ${dependency}`);
      }
      if (dependency === job.key) throw new Error(`Action job ${job.key} cannot need itself`);
    }
  }

  const byKey = new Map(workflow.jobs.map((job) => [job.key, job]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string): void => {
    if (visited.has(key)) return;
    if (visiting.has(key)) throw new Error(`Action workflow dependency cycle at ${key}`);
    visiting.add(key);
    for (const dependency of byKey.get(key)?.needs ?? []) visit(dependency);
    visiting.delete(key);
    visited.add(key);
  };
  for (const key of keys) visit(key);
  return workflow;
}

export class ActionsExecutor {
  constructor(
    private readonly runner: ActionJobRunner,
    private readonly maxParallel = 4,
  ) {
    if (!Number.isInteger(maxParallel) || maxParallel < 1 || maxParallel > 64) {
      throw new Error("maxParallel must be between 1 and 64");
    }
  }

  async execute(
    workflow: SentientWorkflow,
    context: ActionExecutionContext,
  ): Promise<ActionsExecutionResult> {
    validateWorkflowDag(workflow);
    const state = new Map<string, ActionJobStatus>(
      workflow.jobs.map((job) => [job.key, "queued"]),
    );
    const results: ActionsExecutionResult["jobs"] = {};
    const byKey = new Map(workflow.jobs.map((job) => [job.key, job]));

    while ([...state.values()].some((status) => status === "queued")) {
      let progressed = false;

      for (const job of workflow.jobs) {
        if (state.get(job.key) !== "queued") continue;
        const dependencyStates = job.needs.map((key) => state.get(key));
        if (dependencyStates.some((status) => status === "failed" || status === "skipped")) {
          state.set(job.key, "skipped");
          results[job.key] = {
            jobKey: job.key,
            status: "skipped",
            attempts: 0,
            summary: "Skipped because a dependency did not complete successfully.",
            logs: "",
          };
          progressed = true;
        }
      }

      const ready = workflow.jobs.filter(
        (job) =>
          state.get(job.key) === "queued" &&
          job.needs.every((key) => state.get(key) === "completed"),
      );

      if (ready.length === 0) {
        if ([...state.values()].some((status) => status === "queued") && !progressed) {
          const blocked = [...state.entries()]
            .filter(([, status]) => status === "queued")
            .map(([key]) => `${key} needs ${(byKey.get(key)?.needs ?? []).join(",")}`)
            .join("; ");
          throw new Error(`Action workflow made no progress: ${blocked}`);
        }
        continue;
      }

      for (let offset = 0; offset < ready.length; offset += this.maxParallel) {
        const batch = ready.slice(offset, offset + this.maxParallel);
        for (const job of batch) state.set(job.key, "running");

        const settled = await Promise.all(
          batch.map(async (job) => {
            const result = await this.runWithRetries(job, context);
            return { job, result };
          }),
        );

        for (const { job, result } of settled) {
          results[job.key] = result;
          state.set(job.key, result.status);
        }
        progressed = true;
      }
    }

    const failed = [...state.values()].some(
      (status) => status === "failed" || status === "skipped",
    );
    return { status: failed ? "failed" : "completed", jobs: results };
  }

  private async runWithRetries(
    job: ActionJob,
    context: ActionExecutionContext,
  ): Promise<ActionJobResult> {
    const logs: string[] = [];
    let lastSummary = "Action job failed";

    for (let attempt = 1; attempt <= job.maxAttempts; attempt += 1) {
      try {
        const result = await this.runner.run(job, context);
        logs.push(result.logs);
        if (result.status === "completed") {
          return { ...result, attempts: attempt, logs: logs.filter(Boolean).join("\n") };
        }
        lastSummary = result.summary;
      } catch (error) {
        lastSummary = error instanceof Error ? error.message : String(error);
        logs.push(`[attempt ${attempt}] ${lastSummary}`);
      }
    }

    return {
      jobKey: job.key,
      status: "failed",
      attempts: job.maxAttempts,
      summary: lastSummary,
      logs: logs.filter(Boolean).join("\n"),
    };
  }
}

export class SandboxActionJobRunner implements ActionJobRunner {
  constructor(
    private readonly sandboxes: SandboxRuntime,
    private readonly workspaces: RepositoryWorkspaceEngine,
  ) {}

  async run(job: ActionJob, context: ActionExecutionContext): Promise<ActionJobResult> {
    const session = await this.sandboxes.create({
      image: job.image,
      cpuCores: job.cpuCores,
      memoryMb: job.memoryMb,
      diskMb: job.diskMb,
      maxPids: job.maxPids,
      timeoutMs: job.timeoutMs,
      egress:
        job.egressHosts.length > 0
          ? { mode: "allow-list", hosts: job.egressHosts }
          : { mode: "deny-all" },
      secrets: context.secrets,
      metadata: {
        installationId: String(context.installationId),
        repository: `${context.repository.owner}/${context.repository.repo}`,
        taskId: context.taskId,
        jobKey: job.key,
      },
    });

    const logs: string[] = [];
    try {
      const workspace = await this.workspaces.create(session, {
        installationId: context.installationId,
        repository: context.repository,
        taskId: context.taskId,
        agentId: `actions-${job.key}`,
        baseRef: context.baseRef,
        cloneUrl: context.cloneUrl,
      });

      for (const step of job.steps) {
        const result = await session.exec({
          argv: ["/bin/sh", "-lc", step.run],
          cwd: workspace.root,
          env: step.env,
          timeoutMs: step.timeoutMs ?? job.timeoutMs,
        });
        logs.push(
          [`## ${step.name}`, result.stdout, result.stderr]
            .filter((value) => value.trim())
            .join("\n"),
        );
        if (result.exitCode !== 0) {
          return {
            jobKey: job.key,
            status: "failed",
            attempts: 1,
            summary: `Step ${step.name} failed with exit code ${result.exitCode}`,
            logs: truncateLogs(logs.join("\n")),
          };
        }
      }

      return {
        jobKey: job.key,
        status: "completed",
        attempts: 1,
        summary: `${job.steps.length} step(s) completed`,
        logs: truncateLogs(logs.join("\n")),
      };
    } finally {
      await session.destroy();
    }
  }
}

function normalizeJob(key: string, raw: unknown): ActionJob {
  validateJobKey(key);
  const value = asRecord(raw, `job ${key}`);
  const resources = value.resources === undefined ? {} : asRecord(value.resources, `job ${key}.resources`);
  const stepsRaw = arrayValue(value.steps, `job ${key}.steps`);
  if (stepsRaw.length === 0) throw new Error(`Action job ${key} requires at least one step`);

  const job: ActionJob = {
    key,
    image: stringValue(value.image, `job ${key}.image`),
    needs: stringArray(value.needs, `job ${key}.needs`),
    steps: stepsRaw.map((step, index) => normalizeStep(key, index, step)),
    cpuCores: integerValue(resources.cpu ?? 2, `job ${key}.resources.cpu`, 1, 64),
    memoryMb: integerValue(resources.memory_mb ?? 4096, `job ${key}.resources.memory_mb`, 128, 262_144),
    diskMb: integerValue(resources.disk_mb ?? 10_240, `job ${key}.resources.disk_mb`, 256, 1_048_576),
    maxPids: integerValue(resources.max_pids ?? 512, `job ${key}.resources.max_pids`, 16, 65_536),
    timeoutMs: integerValue(value.timeout_ms ?? 20 * 60_000, `job ${key}.timeout_ms`, 1_000, 24 * 60 * 60_000),
    egressHosts: stringArray(value.egress_hosts ?? ["github.com"], `job ${key}.egress_hosts`),
    maxAttempts: integerValue(value.max_attempts ?? 1, `job ${key}.max_attempts`, 1, 5),
  };
  return job;
}

function normalizeStep(jobKey: string, index: number, raw: unknown): ActionStep {
  const step = asRecord(raw, `job ${jobKey}.steps[${index}]`);
  const envRaw = step.env === undefined ? {} : asRecord(step.env, `job ${jobKey}.steps[${index}].env`);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(envRaw)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Invalid environment variable ${key}`);
    }
    env[key] = String(value);
  }

  return {
    name:
      typeof step.name === "string" && step.name.trim()
        ? step.name.trim().slice(0, 120)
        : `step-${index + 1}`,
    run: stringValue(step.run, `job ${jobKey}.steps[${index}].run`),
    env,
    timeoutMs:
      step.timeout_ms === undefined
        ? undefined
        : integerValue(step.timeout_ms, `job ${jobKey}.steps[${index}].timeout_ms`, 1, 24 * 60 * 60_000),
  };
}

function validateJobKey(key: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(key)) {
    throw new Error(`Invalid action job key ${JSON.stringify(key)}`);
  }
  return key;
}

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be a mapping`);
  }
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value;
}

function stringValue(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string`);
  return value.trim();
}

function stringArray(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  if (typeof value === "string") return [value];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
    throw new Error(`${name} must be a string or array of strings`);
  }
  return value.map((entry) => (entry as string).trim());
}

function integerValue(value: unknown, name: string, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return number;
}

function truncateLogs(value: string): string {
  const max = 1_000_000;
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n...[truncated ${value.length - max} characters]`;
}
