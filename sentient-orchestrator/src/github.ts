import { createSign } from "node:crypto";
import type { ProgressEvent, ProgressSink } from "./types.js";

interface CachedToken {
  token: string;
  expiresAt: number;
}

export class GitHubAppTokenProvider {
  private readonly cache = new Map<number, CachedToken>();

  constructor(
    private readonly appId: string,
    private readonly privateKey: string,
  ) {}

  async getToken(installationId: number): Promise<string> {
    const cached = this.cache.get(installationId);
    if (cached && cached.expiresAt - Date.now() > 60_000) return cached.token;

    const jwt = this.createJwt();
    const response = await fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${jwt}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "sentient-orchestrator",
        },
      },
    );
    if (!response.ok) {
      throw new Error(`GitHub installation token request failed: ${response.status}`);
    }

    const data = (await response.json()) as { token: string; expires_at: string };
    const entry = { token: data.token, expiresAt: Date.parse(data.expires_at) };
    this.cache.set(installationId, entry);
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

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export class GitHubIssueProgressSink implements ProgressSink {
  constructor(private readonly tokens: GitHubAppTokenProvider) {}

  async publish(event: ProgressEvent): Promise<void> {
    const { origin } = event.task;
    const token = await this.tokens.getToken(origin.installationId);
    const body = renderProgress(event);
    const response = await fetch(
      `https://api.github.com/repos/${origin.repository.owner}/${origin.repository.repo}/issues/${origin.issueNumber}/comments`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "sentient-orchestrator",
        },
        body: JSON.stringify({ body }),
      },
    );
    if (!response.ok) {
      throw new Error(`GitHub progress comment failed: ${response.status}`);
    }
  }
}

function renderProgress(event: ProgressEvent): string {
  const statuses = event.task.agents
    .map((agent) => `- ${agent.status === "completed" ? "✅" : agent.status === "running" ? "🔄" : agent.status === "failed" ? "❌" : "⏳"} ${agent.role}: ${agent.status}`)
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
