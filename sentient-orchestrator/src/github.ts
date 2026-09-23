import { createSign } from "node:crypto";
import type { ProgressEvent, ProgressSink } from "./types.js";

interface CachedToken {
  token: string;
  expiresAt: number;
}

export interface InstallationTokenScope {
  repositoryIds?: number[];
  permissions?: Record<string, "read" | "write">;
}

export class GitHubRateLimitError extends Error {
  constructor(
    message: string,
    public readonly retryAt: Date,
    public readonly status: number,
  ) {
    super(message);
    this.name = "GitHubRateLimitError";
  }
}

export class GitHubAppTokenProvider {
  private readonly cache = new Map<string, CachedToken>();

  constructor(
    private readonly appId: string,
    private readonly privateKey: string,
    private readonly apiBaseUrl = "https://api.github.com",
  ) {}

  async getToken(
    installationId: number,
    scope: InstallationTokenScope = {},
  ): Promise<string> {
    const cacheKey = JSON.stringify({
      installationId,
      repositoryIds: [...(scope.repositoryIds ?? [])].sort((a, b) => a - b),
      permissions: Object.entries(scope.permissions ?? {}).sort(([a], [b]) =>
        a.localeCompare(b),
      ),
    });
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt - Date.now() > 60_000) return cached.token;

    const jwt = this.createJwt();
    const body: Record<string, unknown> = {};
    if (scope.repositoryIds?.length) body.repository_ids = scope.repositoryIds;
    if (scope.permissions && Object.keys(scope.permissions).length) {
      body.permissions = scope.permissions;
    }

    const response = await fetch(
      `${this.apiBaseUrl}/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: githubHeaders(`Bearer ${jwt}`),
        body: Object.keys(body).length ? JSON.stringify(body) : undefined,
      },
    );
    if (!response.ok) {
      throwGitHubError(response, "GitHub installation token request failed");
    }

    const data = (await response.json()) as { token: string; expires_at: string };
    const entry = { token: data.token, expiresAt: Date.parse(data.expires_at) };
    this.cache.set(cacheKey, entry);
    return entry.token;
  }

  private createJwt(): string {
    const now = Math.floor(Date.now() / 1000);
    const header = encode({ alg: "RS256", typ: "JWT" });
    const payload = encode({ iat: now - 30, exp: now + 9 * 60, iss: this.appId });
    const unsigned = `${header}.${payload}`;

    const signer = createSign("RSA-SHA256");
    signer.update(unsigned);
    signer.end();
    const signature = signer.sign(this.privateKey).toString("base64url");
    return `${unsigned}.${signature}`;
  }
}

export class GitHubApiClient {
  constructor(
    private readonly token: string,
    private readonly apiBaseUrl = "https://api.github.com",
    private readonly maxAutomaticRetryMs = 5_000,
  ) {}

  async request(
    path: string,
    init: RequestInit = {},
    retries = 1,
  ): Promise<Response> {
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        ...githubHeaders(`Bearer ${this.token}`),
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });

    if (response.ok) return response;

    const retryAt = getRateLimitRetryAt(response);
    if (retryAt) {
      const delayMs = Math.max(0, retryAt.getTime() - Date.now());
      if (retries > 0 && delayMs <= this.maxAutomaticRetryMs) {
        await sleep(delayMs);
        return this.request(path, init, retries - 1);
      }
      throw new GitHubRateLimitError(
        `GitHub rate limited request ${path}`,
        retryAt,
        response.status,
      );
    }

    throw new Error(`GitHub API request ${path} failed: ${response.status}`);
  }
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export class GitHubIssueProgressSink implements ProgressSink {
  constructor(private readonly tokens: GitHubAppTokenProvider) {}

  async publish(event: ProgressEvent): Promise<void> {
    const { origin } = event.task;
    const token = await this.tokens.getToken(origin.installationId, {
      permissions: { issues: "write" },
    });
    const client = new GitHubApiClient(token);
    const body = renderProgress(event);

    await client.request(
      `/repos/${encodeURIComponent(origin.repository.owner)}/${encodeURIComponent(origin.repository.repo)}/issues/${origin.issueNumber}/comments`,
      {
        method: "POST",
        body: JSON.stringify({ body }),
      },
    );
  }
}

function githubHeaders(authorization: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: authorization,
    "X-GitHub-Api-Version": "2026-03-10",
    "User-Agent": "sentient-orchestrator",
  };
}

function getRateLimitRetryAt(response: Response): Date | null {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return new Date(Date.now() + Math.max(0, seconds) * 1000);
    const date = new Date(retryAfter);
    if (!Number.isNaN(date.getTime())) return date;
  }

  if (
    response.status === 429 ||
    (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0")
  ) {
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    if (Number.isFinite(reset) && reset > 0) return new Date(reset * 1000);
    return new Date(Date.now() + 60_000);
  }

  return null;
}

function throwGitHubError(response: Response, prefix: string): never {
  const retryAt = getRateLimitRetryAt(response);
  if (retryAt) {
    throw new GitHubRateLimitError(prefix, retryAt, response.status);
  }
  throw new Error(`${prefix}: ${response.status}`);
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function renderProgress(event: ProgressEvent): string {
  const statuses = event.task.agents
    .map(
      (agent) =>
        `- ${
          agent.status === "completed"
            ? "✅"
            : agent.status === "running"
              ? "🔄"
              : agent.status === "failed"
                ? "❌"
                : "⏳"
        } ${agent.role}: ${agent.status}`,
    )
    .join("\n");

  return [
    `### 🤖 Sentient — ${event.headline}`,
    event.detail ? `\n${event.detail}` : "",
    `\n**Task:** \`${event.task.id}\``,
    `**Status:** ${event.task.status}`,
    "",
    statuses,
  ].join("\n");
}

export class ConsoleProgressSink implements ProgressSink {
  async publish(event: ProgressEvent): Promise<void> {
    console.log(`[sentient] ${event.task.id} ${event.headline}`, event.detail ?? "");
  }
}
