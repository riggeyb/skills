import type { VercelRequest, VercelResponse } from '@vercel/node';
import { method, sendError } from '../lib/http.js';
import { allowedRepositories, protectedBranches, requireApiKey, writerLimits } from '../lib/security.js';

export default function handler(req: VercelRequest, res: VercelResponse): void {
  try {
    method(req, ['GET']);
    requireApiKey(req.headers['x-writer-key']);
    res.status(200).json({
      provider: 'github-writer-gateway',
      repositories: allowedRepositories(),
      protected_branches: protectedBranches(),
      limits: writerLimits(),
      capabilities: {
        repository_read: true,
        branch_create: true,
        atomic_commit: true,
        pull_request_create: true,
        direct_protected_branch_write: false,
        force_push: false,
        repository_admin: false,
        secrets_access: false,
      },
    });
  } catch (error) {
    sendError(res, error);
  }
}
