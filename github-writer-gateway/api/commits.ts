import type { VercelRequest, VercelResponse } from '@vercel/node';
import { method, sendError } from '../lib/http.js';
import { createAtomicCommit, type Change } from '../lib/github.js';
import { assertAllowedRepository, requireApiKey } from '../lib/security.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    method(req, ['POST']);
    requireApiKey(req.headers['x-writer-key']);
    const repository = String(req.body?.repository ?? '');
    assertAllowedRepository(repository);
    const result = await createAtomicCommit({
      repository,
      branch: String(req.body?.branch ?? ''),
      expectedHeadSha: String(req.body?.expected_head_sha ?? ''),
      message: String(req.body?.message ?? ''),
      changes: (req.body?.changes ?? []) as Change[],
    });
    res.status(201).json(result);
  } catch (error) {
    sendError(res, error);
  }
}
