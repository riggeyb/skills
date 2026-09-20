import { findVerificationRun, getBranchHead } from './github.js';
import type { VerificationClaims, VerificationStatus } from './types.js';

export async function resolveStatus(id: string, claims: VerificationClaims): Promise<VerificationStatus> {
  const run = await findVerificationRun(claims);
  if (!run) {
    return {
      id,
      repository: claims.repository,
      requestedSha: claims.sha,
      testedSha: null,
      branch: claims.branch,
      profile: claims.profile,
      state: 'dispatched',
      workflowRunId: null,
      workflowUrl: null,
      conclusion: null,
      exactHeadMatch: null,
      remoteHead: null,
      certified: false,
    };
  }

  let state: VerificationStatus['state'];
  if (run.status === 'queued' || run.status === 'waiting' || run.status === 'pending') state = 'queued';
  else if (run.status !== 'completed') state = 'running';
  else if (run.conclusion === 'success') state = 'passed';
  else state = 'failed';

  let remoteHead: string | null = null;
  let exactHeadMatch: boolean | null = null;
  if (claims.branch) {
    remoteHead = await getBranchHead(claims.repository, claims.branch);
    exactHeadMatch = remoteHead === claims.sha;
  }

  const testedSha = run.head_sha?.toLowerCase() ?? null;
  const testedExactSha = testedSha === claims.sha;
  const certified = state === 'passed' && testedExactSha && (!claims.requireExactHead || exactHeadMatch === true);

  return {
    id,
    repository: claims.repository,
    requestedSha: claims.sha,
    testedSha,
    branch: claims.branch,
    profile: claims.profile,
    state,
    workflowRunId: run.id,
    workflowUrl: run.html_url,
    conclusion: run.conclusion,
    exactHeadMatch,
    remoteHead,
    certified,
  };
}
