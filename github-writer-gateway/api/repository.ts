import type { VercelRequest, VercelResponse } from '@vercel/node';
import { method, queryString, sendError } from '../lib/http.js';
import { getBranch, getRepository } from '../lib/github.js';
import { assertAllowedRepository, requireApiKey } from '../lib/security.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    method(req, ['GET']);
    requireApiKey(req.headers['x-writer-key']);
    const repository = queryString(req, 'repository');
    assertAllowedRepository(repository);
    const repo = await getRepository(repository);
    const branchName = queryString(req, 'branch') || repo.default_branch;
    const branch = await getBranch(repository, branchName);
    res.status(200).json({
      repository,
      private: Boolean(repo.private),
      default_branch: repo.default_branch,
      branch: branch.branch,
      head_sha: branch.sha,
      branch_protected: branch.protected,
    });
  } catch (error) {
    sendError(res, error);
  }
}
