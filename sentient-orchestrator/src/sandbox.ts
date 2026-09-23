export type EgressPolicy =
  | { mode: "deny-all" }
  | { mode: "allow-list"; hosts: string[] };

export interface SandboxSecret {
  name: string;
  value: string;
  expiresAt: string;
}

export interface SandboxSpec {
  image: string;
  cpuCores: number;
  memoryMb: number;
  diskMb: number;
  maxPids: number;
  timeoutMs: number;
  egress: EgressPolicy;
  secrets?: SandboxSecret[];
  metadata?: Record<string, string>;
}

export interface SandboxCommand {
  argv: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  stdin?: string;
}

export interface SandboxCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface SandboxSession {
  readonly id: string;
  exec(command: SandboxCommand): Promise<SandboxCommandResult>;
  destroy(): Promise<void>;
}

export interface SandboxRuntime {
  create(spec: SandboxSpec): Promise<SandboxSession>;
}

export function validateSandboxSpec(spec: SandboxSpec): SandboxSpec {
  if (!/^[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/i.test(spec.image)) {
    throw new Error("Sandbox image must be pinned by sha256 digest");
  }
  integerRange("cpuCores", spec.cpuCores, 1, 64);
  integerRange("memoryMb", spec.memoryMb, 128, 262_144);
  integerRange("diskMb", spec.diskMb, 256, 1_048_576);
  integerRange("maxPids", spec.maxPids, 16, 65_536);
  integerRange("timeoutMs", spec.timeoutMs, 1_000, 24 * 60 * 60 * 1000);

  if (spec.egress.mode === "allow-list") {
    if (spec.egress.hosts.length === 0) {
      throw new Error("allow-list egress requires at least one host");
    }
    for (const host of spec.egress.hosts) {
      if (!/^[a-z0-9.-]+(?::\d+)?$/i.test(host) || host.includes("..")) {
        throw new Error(`Invalid egress host ${host}`);
      }
    }
  }

  const seen = new Set<string>();
  for (const secret of spec.secrets ?? []) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(secret.name)) {
      throw new Error(`Invalid secret name ${secret.name}`);
    }
    if (seen.has(secret.name)) throw new Error(`Duplicate secret ${secret.name}`);
    seen.add(secret.name);
    if (!secret.value) throw new Error(`Secret ${secret.name} is empty`);
    if (Date.parse(secret.expiresAt) <= Date.now()) {
      throw new Error(`Secret ${secret.name} is already expired`);
    }
  }

  return spec;
}

export function validateSandboxCommand(command: SandboxCommand): SandboxCommand {
  if (!Array.isArray(command.argv) || command.argv.length === 0) {
    throw new Error("Sandbox command requires argv");
  }
  for (const arg of command.argv) {
    if (typeof arg !== "string" || arg.includes("\0")) {
      throw new Error("Sandbox argv contains an invalid argument");
    }
  }
  if (command.cwd && (!command.cwd.startsWith("/") || command.cwd.includes("\0"))) {
    throw new Error("Sandbox cwd must be an absolute path");
  }
  if (command.timeoutMs !== undefined) {
    integerRange("command.timeoutMs", command.timeoutMs, 1, 24 * 60 * 60 * 1000);
  }
  return command;
}

export class RemoteSandboxRuntime implements SandboxRuntime {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceToken: string,
    private readonly requestTimeoutMs = 15_000,
  ) {}

  async create(spec: SandboxSpec): Promise<SandboxSession> {
    validateSandboxSpec(spec);
    const response = await this.request("/v1/sandboxes", {
      method: "POST",
      body: JSON.stringify(spec),
    });
    const body = (await response.json()) as { id?: string };
    if (!body.id) throw new Error("Sandbox service returned no sandbox id");
    return new RemoteSandboxSession(
      body.id,
      this.baseUrl,
      this.serviceToken,
      this.requestTimeoutMs,
    );
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.serviceToken}`,
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });
      if (!response.ok) {
        throw new Error(`Sandbox service ${path} failed: ${response.status}`);
      }
      return response;
    } finally {
      clearTimeout(timer);
    }
  }
}

class RemoteSandboxSession implements SandboxSession {
  constructor(
    public readonly id: string,
    private readonly baseUrl: string,
    private readonly serviceToken: string,
    private readonly requestTimeoutMs: number,
  ) {}

  async exec(command: SandboxCommand): Promise<SandboxCommandResult> {
    validateSandboxCommand(command);
    const timeoutMs = Math.max(this.requestTimeoutMs, command.timeoutMs ?? 0);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs + 2_000);
    try {
      const response = await fetch(
        `${this.baseUrl.replace(/\/$/, "")}/v1/sandboxes/${encodeURIComponent(this.id)}/exec`,
        {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${this.serviceToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(command),
        },
      );
      if (!response.ok) {
        throw new Error(`Sandbox exec failed: ${response.status}`);
      }
      const body = (await response.json()) as Partial<SandboxCommandResult>;
      if (
        typeof body.exitCode !== "number" ||
        typeof body.stdout !== "string" ||
        typeof body.stderr !== "string" ||
        typeof body.durationMs !== "number"
      ) {
        throw new Error("Sandbox exec returned an invalid response");
      }
      return body as SandboxCommandResult;
    } finally {
      clearTimeout(timer);
    }
  }

  async destroy(): Promise<void> {
    const response = await fetch(
      `${this.baseUrl.replace(/\/$/, "")}/v1/sandboxes/${encodeURIComponent(this.id)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${this.serviceToken}` },
      },
    );
    if (!response.ok && response.status !== 404) {
      throw new Error(`Sandbox destroy failed: ${response.status}`);
    }
  }
}

function integerRange(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
}
