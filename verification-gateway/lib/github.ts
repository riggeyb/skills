import { requireEnv } from './security.js';
import type { GitHubWorkflowRun, VerificationClaims } from './types.js';

const API = 'https://api.github.com';

async function gh(path: string, init: RequestInit = {}): Promise<Response> {
  const token = requireEnv('GITHUB_TOKEN');
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'riggeyb-verification-gateway',
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw Object.assign(new Error(`GitHub ${response.status}: ${text.slice(0, 800)}`), { statusCode: response.status >= 500 ? 502 : response.status });
  }
  return response;
}

export async function assertVerificationContract(repository: string, sha: string): Promise<void> {
  await gh(`/repos/${repository}/contents/.gpt/verification.yaml?ref=${encodeURIComponent(sha)}`);
  await gh(`/repos/${repository}/contents/.github/workflows/gpt-verify.yml`);
  await gh(`/repos/${repository}/commits/${sha}`);
}

export async function dispatchVerification(claims: VerificationClaims): Promise<void> {
  await gh(`/repos/${claims.repository}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({
      event_type: 'gpt-verify',
      client_payload: {
        verification_id: claims.nonce,
        sha: claims.sha,
        profile: claims.profile,
      },
    }),
  });
}

export async function findVerificationRun(claims: VerificationClaims): Promise<GitHubWorkflowRun | null> {
  const response = await gh(`/repos/${claims.repository}/actions/workflows/gpt-verify.yml/runs?event=repository_dispatch&per_page=100`);
  const data = await response.json() as { workflow_runs?: GitHubWorkflowRun[] };
  const title = `gpt-verify:${claims.nonce}`;
  return data.workflow_runs?.find((run) => run.display_title === title || run.name === title) ?? null;
}

export async function getBranchHead(repository: string, branch: string): Promise<string> {
  const response = await gh(`/repos/${repository}/branches/${encodeURIComponent(branch)}`);
  const data = await response.json() as { commit: { sha: string } };
  return data.commit.sha.toLowerCase();
}

export async function getArtifacts(repository: string, runId: number): Promise<any[]> {
  const response = await gh(`/repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`);
  const data = await response.json() as { artifacts?: any[] };
  return (data.artifacts ?? []).map((a) => ({ id: a.id, name: a.name, sizeInBytes: a.size_in_bytes, expired: a.expired, createdAt: a.created_at }));
}

export async function getJobs(repository: string, runId: number): Promise<any[]> {
  const response = await gh(`/repos/${repository}/actions/runs/${runId}/jobs?per_page=100`);
  const data = await response.json() as { jobs?: any[] };
  return (data.jobs ?? []).map((j) => ({
    id: j.id,
    name: j.name,
    status: j.status,
    conclusion: j.conclusion,
    startedAt: j.started_at,
    completedAt: j.completed_at,
    steps: (j.steps ?? []).map((s: any) => ({ name: s.name, status: s.status, conclusion: s.conclusion, number: s.number })),
  }));
}
