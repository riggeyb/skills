export type VerificationClaims = {
  v: 1;
  nonce: string;
  repository: string;
  sha: string;
  branch: string | null;
  profile: string;
  requestedAt: string;
  requireExactHead: boolean;
};

export type GitHubWorkflowRun = {
  id: number;
  name?: string;
  display_title?: string;
  status: string;
  conclusion: string | null;
  head_sha: string;
  html_url: string;
  created_at: string;
};

export type VerificationStatus = {
  id: string;
  repository: string;
  requestedSha: string;
  testedSha: string | null;
  branch: string | null;
  profile: string;
  state: 'dispatched' | 'queued' | 'running' | 'passed' | 'failed';
  workflowRunId: number | null;
  workflowUrl: string | null;
  conclusion: string | null;
  exactHeadMatch: boolean | null;
  remoteHead: string | null;
  certified: boolean;
};
