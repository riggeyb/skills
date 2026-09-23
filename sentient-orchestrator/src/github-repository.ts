import {
  GitHubApiClient,
  GitHubAppTokenProvider,
  type InstallationTokenScope,
} from "./github.js";

export interface GitHubRepositoryContext {
  installationId: number;
  repositoryId?: number;
  owner: string;
  repo: string;
}

export async function githubRepositoryClient(
  tokens: GitHubAppTokenProvider,
  repository: GitHubRepositoryContext,
  permissions: InstallationTokenScope["permissions"],
): Promise<GitHubApiClient> {
  const token = await tokens.getToken(repository.installationId, {
    repositoryIds:
      repository.repositoryId === undefined ? undefined : [repository.repositoryId],
    permissions,
  });
  return new GitHubApiClient(token);
}

export function githubRepoPath(repository: GitHubRepositoryContext): string {
  return `/repos/${component(repository.owner)}/${component(repository.repo)}`;
}

function component(value: string): string {
  if (!value || value.includes("/") || value.includes("\0")) {
    throw new Error("Invalid GitHub repository component");
  }
  return encodeURIComponent(value);
}
