import type { RuntimeRequirements, SentientWorker, WorkerRuntime } from "./worker-control.js";

export interface RemoteSentientRuntimeOptions {
  baseUrl: string;
  token?: string;
  capabilities?: string[];
  timeoutMs?: number;
  id?: string;
}

interface RemoteResponse {
  handle?: unknown;
  status?: unknown;
  spentUsd?: unknown;
  reason?: unknown;
  result?: unknown;
}

const ALLOWED_STATUSES = new Set(["starting", "running", "blocked", "waiting", "completed", "failed", "cancelled"]);

export class RemoteSentientRuntime implements WorkerRuntime {
  readonly id: string;
  private readonly baseUrl: URL;
  private readonly token?: string;
  private readonly capabilities: string[];
  private readonly timeoutMs: number;

  constructor(options: RemoteSentientRuntimeOptions) {
    this.baseUrl = validateBaseUrl(options.baseUrl);
    this.token = options.token;
    this.capabilities = options.capabilities ?? ["remote-worker"];
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.id = options.id ?? "remote-http";
  }

  compatible(requirements: RuntimeRequirements): boolean {
    return requirements.capabilities.every((capability) => this.capabilities.includes(capability));
  }

  async spawn(worker: SentientWorker, requirements: RuntimeRequirements): Promise<{ handle: string }> {
    const response = await this.request("POST", "/v1/workers", {
      protocolVersion: "1.0",
      runtimeId: this.id,
      sentient: {
        workerId: worker.id,
        spawnRequestId: worker.spawnRequestId,
        taskId: worker.taskId,
        tenantId: worker.tenant,
        role: worker.role,
        correlationId: worker.correlationId,
        parentWorkerId: worker.parentWorkerId ?? null,
        attempt: worker.attemptCount,
        budgetUsd: worker.budgetUsd ?? null,
      },
      requirements,
    });
    if (typeof response.handle !== "string" || response.handle.length === 0) {
      throw new Error("Remote worker spawn response is missing a non-empty handle");
    }
    return { handle: response.handle };
  }

  async assign(handle: string, assignment: unknown): Promise<void> {
    await this.request("POST", `/v1/workers/${encodeURIComponent(handle)}/assignment`, {
      protocolVersion: "1.0",
      assignment,
      reportingContract: {
        terminalResult: {
          required: true,
          format: "sentient-handoff-v1",
          fields: [
            "handoffId",
            "objective",
            "completedWork",
            "filesCommitsArtifacts",
            "findings",
            "unresolvedQuestions",
            "dependencies",
            "testsResults",
            "risks",
            "recommendedNextAction",
          ],
        },
      },
    });
  }

  async inspect(handle: string): Promise<{ status: string; spentUsd?: number; reason?: string; result?: unknown }> {
    const response = await this.request("GET", `/v1/workers/${encodeURIComponent(handle)}`);
    if (typeof response.status !== "string" || !ALLOWED_STATUSES.has(response.status)) {
      throw new Error("Remote worker returned an invalid status");
    }
    if (response.spentUsd !== undefined && (typeof response.spentUsd !== "number" || response.spentUsd < 0 || !Number.isFinite(response.spentUsd))) {
      throw new Error("Remote worker returned invalid spentUsd");
    }
    if (response.reason !== undefined && typeof response.reason !== "string") {
      throw new Error("Remote worker returned invalid reason");
    }
    return {
      status: response.status,
      spentUsd: response.spentUsd as number | undefined,
      reason: response.reason as string | undefined,
      result: response.result,
    };
  }

  async cancel(handle: string, reason: string): Promise<void> {
    await this.request("POST", `/v1/workers/${encodeURIComponent(handle)}/cancel`, { reason });
  }

  async terminate(handle: string, reason: string): Promise<void> {
    await this.request("POST", `/v1/workers/${encodeURIComponent(handle)}/terminate`, { reason });
  }

  private async request(method: string, path: string, body?: unknown): Promise<RemoteResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    timer.unref?.();

    try {
      const url = new URL(path.replace(/^\/+/, ""), ensureTrailingSlash(this.baseUrl));
      if (url.origin !== this.baseUrl.origin) throw new Error("Remote worker request escaped configured origin");

      const headers: Record<string, string> = { Accept: "application/json" };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (this.token) headers.Authorization = `Bearer ${this.token}`;

      const response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal: controller.signal,
      });
      const text = await response.text();
      if (text.length > 1_048_576) throw new Error("Remote worker response exceeds 1 MiB");
      if (!response.ok) {
        throw new Error(`Remote worker request failed with HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
      }
      if (!text) return {};
      const parsed = JSON.parse(text);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Remote worker response must be a JSON object");
      }
      return parsed as RemoteResponse;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Remote worker request timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function validateBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Remote worker base URL cannot include credentials, query parameters, or fragments");
  }
  if (url.protocol === "https:") return url;
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "::1";
  if (url.protocol === "http:" && local) return url;
  throw new Error("Remote worker base URL must use HTTPS; HTTP is allowed only for localhost");
}

function ensureTrailingSlash(url: URL): URL {
  const copy = new URL(url.toString());
  if (!copy.pathname.endsWith("/")) copy.pathname += "/";
  return copy;
}
