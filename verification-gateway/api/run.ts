import type { VercelRequest, VercelResponse } from '@vercel/node';
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
    res.status(200).json(status);
  } catch (e) { sendError(res, e); }
}
