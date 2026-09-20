import type { VercelRequest, VercelResponse } from '@vercel/node';
import { method, sendError } from '../lib/http.js';
import { openPullRequest } from '../lib/github.js';
import { assertAllowedRepository, requireApiKey } from '../lib/security.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    method(req, ['POST']);
    requireApiKey(req.headers['x-writer-key']);
    const repository = String(req.body?.repository ?? '');
    assertAllowedRepository(repository);
    const pr = await openPullRequest({
      repository,
      head: String(req.body?.head ?? ''),
      base: String(req.body?.base ?? ''),
      title: String(req.body?.title ?? ''),
      body: req.body?.body == null ? '' : String(req.body.body),
      draft: Boolean(req.body?.draft),
    });
    res.status(201).json({
      number: pr.number,
      state: pr.state,
      draft: Boolean(pr.draft),
      html_url: pr.html_url,
      head: pr.head?.ref,
      head_sha: pr.head?.sha,
      base: pr.base?.ref,
    });
  } catch (error) {
    sendError(res, error);
  }
}
