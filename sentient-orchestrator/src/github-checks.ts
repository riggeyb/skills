import { GitHubAppTokenProvider } from "./github.js";
import {
  githubRepoPath,
  githubRepositoryClient,
  type GitHubRepositoryContext,
} from "./github-repository.js";

export type CheckConclusion =
  | "action_required"
  | "cancelled"
  | "failure"
  | "neutral"
  | "success"
  | "skipped"
  | "stale"
  | "timed_out";

export interface CheckAnnotation {
  path: string;
  startLine: number;
  endLine?: number;
  level: "notice" | "warning" | "failure";
  message: string;
  title?: string;
}

export interface CheckRunRef {
  id: number;
  name: string;
  headSha: string;
}

export class GitHubChecksReporter {
  constructor(private readonly tokens: GitHubAppTokenProvider) {}

  async create(
    repository: GitHubRepositoryContext,
    input: { name: string; headSha: string; title?: string; summary?: string },
  ): Promise<CheckRunRef> {
    const client = await githubRepositoryClient(this.tokens, repository, { checks: "write" });
    const response = await client.request(`${githubRepoPath(repository)}/check-runs`, {
      method: "POST",
      body: JSON.stringify({
        name: required(input.name, "check name").slice(0, 100),
        head_sha: validateSha(input.headSha),
        status: "in_progress",
        started_at: new Date().toISOString(),
        ...(input.title || input.summary
          ? {
              output: {
                title: (input.title ?? input.name).slice(0, 255),
                summary: (input.summary ?? "Sentient execution started.").slice(0, 65_535),
              },
            }
          : {}),
      }),
    });
    const body = (await response.json()) as { id?: number; name?: string; head_sha?: string };
    if (!Number.isSafeInteger(body.id)) throw new Error("GitHub check-run response is missing id");
    return {
      id: Number(body.id),
      name: body.name ?? input.name,
      headSha: body.head_sha ?? input.headSha,
    };
  }

  async complete(
    repository: GitHubRepositoryContext,
    check: CheckRunRef,
    input: {
      conclusion: CheckConclusion;
      title: string;
      summary: string;
      text?: string;
      annotations?: CheckAnnotation[];
    },
  ): Promise<void> {
    const client = await githubRepositoryClient(this.tokens, repository, { checks: "write" });
    const annotations = (input.annotations ?? []).map(buildCheckAnnotation);
    const batches =
      annotations.length === 0
        ? [[]]
        : Array.from({ length: Math.ceil(annotations.length / 50) }, (_, index) =>
            annotations.slice(index * 50, index * 50 + 50),
          );

    for (let index = 0; index < batches.length; index += 1) {
      const final = index === batches.length - 1;
      await client.request(`${githubRepoPath(repository)}/check-runs/${check.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...(final
            ? {
                status: "completed",
                conclusion: input.conclusion,
                completed_at: new Date().toISOString(),
              }
            : {}),
          output: {
            title: required(input.title, "check output title").slice(0, 255),
            summary: required(input.summary, "check output summary").slice(0, 65_535),
            ...(input.text ? { text: input.text.slice(0, 65_535) } : {}),
            ...(batches[index]!.length ? { annotations: batches[index] } : {}),
          },
        }),
      });
    }
  }
}

export function buildCheckAnnotation(annotation: CheckAnnotation): Record<string, unknown> {
  if (
    !annotation.path ||
    annotation.path.startsWith("/") ||
    annotation.path.includes("..") ||
    annotation.path.includes("\0")
  ) {
    throw new Error(`Invalid check annotation path ${JSON.stringify(annotation.path)}`);
  }
  if (!Number.isInteger(annotation.startLine) || annotation.startLine < 1) {
    throw new Error("Check annotation startLine must be a positive integer");
  }
  const endLine = annotation.endLine ?? annotation.startLine;
  if (!Number.isInteger(endLine) || endLine < annotation.startLine) {
    throw new Error("Check annotation endLine must be >= startLine");
  }
  return {
    path: annotation.path,
    start_line: annotation.startLine,
    end_line: endLine,
    annotation_level: annotation.level,
    message: required(annotation.message, "annotation message").slice(0, 65_535),
    ...(annotation.title ? { title: annotation.title.slice(0, 255) } : {}),
  };
}

function validateSha(value: string): string {
  if (!/^[a-f0-9]{40}$|^[a-f0-9]{64}$/i.test(value)) throw new Error("Invalid Git commit SHA");
  return value;
}

function required(value: string, name: string): string {
  if (!value.trim()) throw new Error(`${name} cannot be empty`);
  return value.trim();
}
