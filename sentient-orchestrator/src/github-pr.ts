import { GitHubAppTokenProvider } from "./github.js";
import {
  githubRepoPath,
  githubRepositoryClient,
  type GitHubRepositoryContext,
} from "./github-repository.js";

export interface PullRequestRef {
  number: number;
  url: string;
}

export class GitHubPullRequestReporter {
  constructor(private readonly tokens: GitHubAppTokenProvider) {}

  async create(
    repository: GitHubRepositoryContext,
    input: {
      head: string;
      base: string;
      title: string;
      body: string;
      draft?: boolean;
    },
  ): Promise<PullRequestRef> {
    validateRefName(input.head);
    validateRefName(input.base);
    const client = await githubRepositoryClient(this.tokens, repository, {
      pull_requests: "write",
    });
    const response = await client.request(`${githubRepoPath(repository)}/pulls`, {
      method: "POST",
      body: JSON.stringify({
        head: input.head,
        base: input.base,
        title: required(input.title, "pull request title").slice(0, 256),
        body: input.body.slice(0, 65_535),
        draft: input.draft ?? false,
      }),
    });
    const body = (await response.json()) as { number?: number; html_url?: string };
    if (!Number.isSafeInteger(body.number) || typeof body.html_url !== "string") {
      throw new Error("GitHub pull request response is invalid");
    }
    return { number: Number(body.number), url: body.html_url };
  }
}

export function validateRefName(value: string): string {
  const forbidden = /[\x00-\x20~^:?*\[\\]/;
  if (
    !value ||
    value.length > 240 ||
    value.startsWith("-") ||
    value.includes("..") ||
    value.includes("@{") ||
    value.includes("\\") ||
    forbidden.test(value) ||
    value.endsWith("/") ||
    value.endsWith(".") ||
    value.includes("//")
  ) {
    throw new Error(${value} is not a valid Git ref`);
  }
  return value;
}

function required(value: string, name: string): string {
  if (!value.trim()) throw new Error(`${name} cannot be empty`);
  return value.trim();
}
