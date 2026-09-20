import type { VercelRequest, VercelResponse } from '@vercel/node';
import { method, sendError } from '../lib/http.js';
import { createBranch } from '../lib/github.js';
import { assertAllowedRepository, requireApiKey } from '../lib/security.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    method(req, ['POST']);
    requireApiKey(req.headers['x-writer-key']);
    const repository = String(req.body?.repository ?? '');
    const branch = String(req.body?.branch ?? '');
    const fromSha = String(req.body?.from_sha ?? '');
    assertAllowedRepository(repository);
    res.status(201).json(await createBranch(repository, branch, fromSha));
  } catch (error) {
    sendError(res, error);
  }
}
