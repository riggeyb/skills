import type { SandboxSession } from "./sandbox.js";

export interface WorkspaceRef {
  installationId: number;
  repository: { owner: string; repo: string };
  taskId: string;
  agentId: string;
  baseRef: string;
}

export interface Workspace {
  root: string;
  branch: string;
}

export class RepositoryWorkspaceEngine {
  constructor(
    private readonly allowedCloneHosts = ["github.com"],
    private readonly root = "/workspace",
  ) {}

  async create(
    session: SandboxSession,
    input: WorkspaceRef & { cloneUrl: string },
  ): Promise<Workspace> {
    const clone = new URL(input.cloneUrl);
    if (clone.protocol !== "https:" || !this.allowedCloneHosts.includes(clone.hostname)) {
      throw new Error(`Clone host ${clone.hostname} is not allowed`);
    }
    validateGitRef(input.baseRef);

    const owner = safeSegment(input.repository.owner);
    const repo = safeSegment(input.repository.repo);
    const branch = workspaceBranch(input.taskId, input.agentId);
    const root = `${this.root}/${owner}/${repo}/${safeSegment(input.taskId)}/${safeSegment(input.agentId)}`;

    await mustExec(session, {
      argv: ["git", "clone", "--filter=blob:none", "--no-tags", input.cloneUrl, root],
      timeoutMs: 10 * 60_000,
    });
    await mustExec(session, {
      argv: ["git", "fetch", "--depth=1", "origin", input.baseRef],
      cwd: root,
      timeoutMs: 5 * 60_000,
    });
    await mustExec(session, {
      argv: ["git", "checkout", "-B", branch, "FETCH_HEAD"],
      cwd: root,
    });

    return { root, branch };
  }

  async commit(
    session: SandboxSession,
    workspace: Workspace,
    message: string,
  ): Promise<string | null> {
    if (!message.trim()) throw new Error("Commit message cannot be empty");
    await mustExec(session, { argv: ["git", "add", "--all"], cwd: workspace.root });
    const diff = await mustExec(session, {
      argv: ["git", "diff", "--cached", "--quiet"],
      cwd: workspace.root,
      allowExitCodes: [0, 1],
    });
    if (diff.exitCode === 0) return null;

    await mustExec(session, {
      argv: ["git", "commit", "-m", message.slice(0, 240)],
      cwd: workspace.root,
    });
    const rev = await mustExec(session, {
      argv: ["git", "rev-parse", "HEAD"],
      cwd: workspace.root,
    });
    return rev.stdout.trim();
  }

  async push(
    session: SandboxSession,
    workspace: Workspace,
  ): Promise<void> {
    await mustExec(session, {
      argv: ["git", "push", "--force-with-lease", "origin", `HEAD:refs/heads/${workspace.branch}`],
      cwd: workspace.root,
      timeoutMs: 5 * 60_000,
    });
  }

  async diff(
    session: SandboxSession,
    workspace: Workspace,
    baseRef: string,
  ): Promise<string> {
    validateGitRef(baseRef);
    const result = await mustExec(session, {
      argv: ["git", "diff", `origin/${baseRef}...HEAD`],
      cwd: workspace.root,
    });
    return result.stdout;
  }
}

export function workspaceBranch(taskId: string, agentId: string): string {
  return `sentient/${safeSegment(taskId)}/${safeSegment(agentId)}`.slice(0, 200);
}

export function validateGitRef(ref: string): string {
  if (
    !ref ||
    ref.length > 240 ||
    ref.startsWith("-") ||
    ref.includes("..") ||
    ref.includes("@{") ||
    ref.includes("\\") ||
    ref.includes(" ") ||
    /[\x00-\x20~^:?*[]/.test(ref) ||
    ref.endsWith("/") ||
    ref.endsWith(".") ||
    ref.includes("//")
  ) {
    throw new Error(`Invalid git ref ${JSON.stringify(ref)}`);
  }
  return ref;
}

export function safeSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .replace(/-{2,}/g, "-");
  if (!normalized || normalized === "." || normalized === "..") {
    throw new Error("Unsafe workspace segment");
  }
  return normalized.slice(0, 64);
}

async function mustExec(
  session: SandboxSession,
  input: {
    argv: string[];
    cwd?: string;
    timeoutMs?: number;
    allowExitCodes?: number[];
  },
) {
  const result = await session.exec({
    argv: input.argv,
    cwd: input.cwd,
    timeoutMs: input.timeoutMs,
  });
  const allowed = input.allowExitCodes ?? [0];
  if (!allowed.includes(result.exitCode)) {
    throw new Error(
      `Sandbox command failed (${input.argv[0]}): exit ${result.exitCode}: ${result.stderr.slice(0, 1000)}`,
    );
  }
  return result;
}
