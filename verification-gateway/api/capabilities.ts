import type { VercelRequest, VercelResponse } from '@vercel/node';
import { method, sendError } from '../lib/http.js';
import { requireApiKey } from '../lib/security.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    method(req, ['GET']);
    requireApiKey(req.headers['x-verification-key']);
    res.status(200).json({
      version: 1,
      executionBackend: 'github-actions',
      dispatch: 'repository_dispatch',
      exactShaCheckout: true,
      exactHeadCertification: true,
      durableArtifacts: true,
      repositoryOwnedProfiles: true,
      statelessSignedRunIds: true,
      operations: ['startVerification', 'getVerificationRun', 'getVerificationEvidence'],
    });
  } catch (e) { sendError(res, e); }
}
