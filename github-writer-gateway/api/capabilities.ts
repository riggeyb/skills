import type { VercelRequest, VercelResponse } from '@vercel/node';
import { method, sendError } from '../lib/http.js';
import { allowedRepositories, requireApiKey, writerLimits } from '../lib/security.js';

export default function handler(req: VercelRequest, res: VercelResponse): void {
  try {
    method(req, ['GET']);
    requireApiKey(req.headers['x-writer-key']);
    res.status(200).json({
      provider: 'github-writer-gateway',
      repositories: allowedRepositories(),
      limits: writerLimits(),
      capabilities: {
        repository_read: true,
        branch_create: true,
        commit_create: true,
        pull_request_create: true,
        force_push: false,
        repository_admin: false,
        secrets_access: false,
      },
    });
  } catch (error) {
    sendError(res, error);
  }
}
