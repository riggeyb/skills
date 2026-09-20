import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getArtifacts, getJobs } from '../lib/github.js';
import { method, queryString, sendError } from '../lib/http.js';
import { requireApiKey, verifyClaims } from '../lib/security.js';
import { resolveStatus } from '../lib/status.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    method(req, ['GET']);
    requireApiKey(req.headers['x-verification-key']);
    const id = queryString(req, 'id');
    const claims = verifyClaims(id);
    const status = await resolveStatus(id, claims);
    if (!status.workflowRunId) {
      res.status(200).json({ status, jobs: [], artifacts: [] });
      return;
    }
    const [jobs, artifacts] = await Promise.all([
      getJobs(claims.repository, status.workflowRunId),
      getArtifacts(claims.repository, status.workflowRunId),
    ]);
    res.status(200).json({ status, jobs, artifacts });
  } catch (e) { sendError(res, e); }
}
