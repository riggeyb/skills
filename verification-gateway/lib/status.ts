import { findVerificationRun, getBranchHead, getJobs } from './github.js';
import type { VerificationClaims, VerificationStatus } from './types.js';

export async function resolveStatus(id: string, claims: VerificationClaims): Promise<VerificationStatus> {
  const run = await findVerificationRun(claims);
  if (!run) {
    return {
      id,
      repository: claims.repository,
      requestedSha: claims.sha,
      testedSha: null,
      workflowEventSha: null,
      exactCheckoutProven: false,
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

  let exactCheckoutProven = false;
  if (run.id) {
    const jobs = await getJobs(claims.repository, run.id);
    exactCheckoutProven = jobs.some((job) =>
      job.steps?.some((step: any) => step.name === 'Prove exact checkout' && step.conclusion === 'success') &&
      job.steps?.some((step: any) => step.name === 'Run repository verification profile' && step.conclusion === 'success')
    );
  }

  let remoteHead: string | null = null;
  let exactHeadMatch: boolean | null = null;
  if (claims.branch) {
    remoteHead = await getBranchHead(claims.repository, claims.branch);
    exactHeadMatch = remoteHead === claims.sha;
  }

  const testedSha = exactCheckoutProven ? claims.sha : null;
  const certified = state === 'passed' && exactCheckoutProven && (!claims.requireExactHead || exactHeadMatch === true);

  return {
    id,
    repository: claims.repository,
    requestedSha: claims.sha,
    testedSha,
    workflowEventSha: run.head_sha?.toLowerCase() ?? null,
    exactCheckoutProven,
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
