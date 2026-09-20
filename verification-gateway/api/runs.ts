import type { VercelRequest, VercelResponse } from '@vercel/node';
import { assertVerificationContract, dispatchVerification } from '../lib/github.js';
import { method, sendError } from '../lib/http.js';
import { newClaims, requireApiKey, signClaims, validateRequest } from '../lib/security.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    method(req, ['POST']);
    requireApiKey(req.headers['x-verification-key']);
    const input = validateRequest(req.body);
    await assertVerificationContract(input.repository, input.sha);
    const claims = newClaims(input);
    await dispatchVerification(claims);
    const id = signClaims(claims);
    res.status(202).json({ id, state: 'dispatched', repository: claims.repository, sha: claims.sha, branch: claims.branch, profile: claims.profile, requireExactHead: claims.requireExactHead });
  } catch (e) { sendError(res, e); }
}
