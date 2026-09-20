import type { VercelRequest, VercelResponse } from '@vercel/node';
import { method, queryString, sendError } from '../lib/http.js';
import { readFile } from '../lib/github.js';
import { assertAllowedRepository, requireApiKey } from '../lib/security.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    method(req, ['GET']);
    requireApiKey(req.headers['x-writer-key']);
    const repository = queryString(req, 'repository');
    const path = queryString(req, 'path');
    const ref = queryString(req, 'ref');
    assertAllowedRepository(repository);
    res.status(200).json(await readFile(repository, path, ref));
  } catch (error) {
    sendError(res, error);
  }
}
