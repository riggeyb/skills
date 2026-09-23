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
  const forbidden = new Set(["~", "^", ":", "?", "*", "[", "\\"]);
  const hasForbiddenCharacter = [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x20 || code === 0x7f || forbidden.has(character);
  });

  if (
    !value ||
    value.length > 240 ||
    value.startsWith("-") ||
    value.includes("..") ||
    value.includes("@{") ||
    value.endsWith("/") ||
    value.endsWith(".") ||
    value.includes("//") ||
    hasForbiddenCharacter
  ) {
    throw new Error(`Invalid Git ref ${JSON.stringify(value)}`);
  }
  return value;
}

function required(value: string, name: string): string {
  if (!value.trim()) throw new Error(`${name} cannot be empty`);
  return value.trim();
}
