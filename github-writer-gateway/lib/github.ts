import { assertAllowedRepository, assertBranch, assertPath, assertSha, requireEnv, writerLimits } from './security.js';

type Json = Record<string, any> | any[];

async function github(repository: string, path: string, init: RequestInit = {}): Promise<any> {
  assertAllowedRepository(repository);
  const token = requireEnv('GITHUB_WRITER_TOKEN');
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'riggeyb-github-writer-gateway',
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body: any = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  if (!response.ok) {
    const message = typeof body === 'object' && body?.message ? body.message : `GitHub request failed (${response.status})`;
    throw Object.assign(new Error(message), { statusCode: response.status, github: body });
  }
  return body;
}

export async function getRepository(repository: string): Promise<any> {
  return github(repository, '');
}

export async function getBranch(repository: string, branch: string): Promise<{ branch: string; sha: string; protected: boolean }> {
  assertBranch(branch);
  const data = await github(repository, `/branches/${encodeURIComponent(branch)}`);
  return { branch: data.name, sha: data.commit.sha, protected: Boolean(data.protected) };
}

export async function readFile(repository: string, path: string, ref: string): Promise<any> {
  assertPath(path);
  if (!ref) throw Object.assign(new Error('ref is required'), { statusCode: 400 });
  const data = await github(repository, `/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`);
  if (Array.isArray(data)) throw Object.assign(new Error('Path is a directory, not a file'), { statusCode: 400 });
  let content: string | null = null;
  if (data.encoding === 'base64' && typeof data.content === 'string') {
    content = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8');
  }
  return { name: data.name, path: data.path, sha: data.sha, size: data.size, encoding: data.encoding, content };
}

export async function createBranch(repository: string, branch: string, fromSha: string): Promise<{ branch: string; sha: string }> {
  assertAllowedRepository(repository);
  assertBranch(branch);
  assertSha(fromSha, 'from_sha');
  await github(repository, '/git/refs', {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: fromSha.toLowerCase() }),
  });
  return { branch, sha: fromSha.toLowerCase() };
}

export type Change =
  | { action: 'upsert'; path: string; content: string }
  | { action: 'delete'; path: string };

export async function createAtomicCommit(input: {
  repository: string;
  branch: string;
  message: string;
  changes: Change[];
}): Promise<{ branch: string; previous_sha: string; commit_sha: string; tree_sha: string; change_count: number }> {
  const { repository, branch, message, changes } = input;
  assertAllowedRepository(repository);
  assertBranch(branch);
  if (!message.trim() || message.length > 500) throw Object.assign(new Error('Commit message must be 1-500 characters'), { statusCode: 400 });
  const limits = writerLimits();
  if (!Array.isArray(changes) || changes.length < 1 || changes.length > limits.maxChanges) {
    throw Object.assign(new Error(`changes must contain 1-${limits.maxChanges} items`), { statusCode: 400 });
  }
  const seen = new Set<string>();
  let bytes = 0;
  for (const change of changes) {
    assertPath(change.path);
    if (seen.has(change.path)) throw Object.assign(new Error(`Duplicate path in changes: ${change.path}`), { statusCode: 400 });
    seen.add(change.path);
    if (change.action === 'upsert') bytes += Buffer.byteLength(change.content, 'utf8');
    else if (change.action !== 'delete') throw Object.assign(new Error(`Invalid change action for ${change.path}`), { statusCode: 400 });
  }
  if (bytes > limits.maxBytes) throw Object.assign(new Error(`Commit content exceeds ${limits.maxBytes} bytes`), { statusCode: 413 });

  const current = await getBranch(repository, branch);
  const parentSha = current.sha.toLowerCase();
  const baseCommit = await github(repository, `/git/commits/${parentSha}`);
  const treeEntries: any[] = [];
  for (const change of changes) {
    if (change.action === 'delete') {
      treeEntries.push({ path: change.path, mode: '100644', type: 'blob', sha: null });
      continue;
    }
    const blob = await github(repository, '/git/blobs', {
      method: 'POST',
      body: JSON.stringify({ content: change.content, encoding: 'utf-8' }),
    });
    treeEntries.push({ path: change.path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  const tree = await github(repository, '/git/trees', {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree: treeEntries }),
  });
  const commit = await github(repository, '/git/commits', {
    method: 'POST',
    body: JSON.stringify({ message: message.trim(), tree: tree.sha, parents: [parentSha] }),
  });
  await github(repository, `/git/refs/heads/${branch.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha, force: false }),
  });

  return { branch, previous_sha: parentSha, commit_sha: commit.sha, tree_sha: tree.sha, change_count: changes.length };
}

export async function openPullRequest(input: {
  repository: string;
  head: string;
  base: string;
  title: string;
  body?: string;
  draft?: boolean;
}): Promise<any> {
  assertAllowedRepository(input.repository);
  assertBranch(input.head);
  assertBranch(input.base);
  if (!input.title.trim() || input.title.length > 256) throw Object.assign(new Error('PR title must be 1-256 characters'), { statusCode: 400 });
  return github(input.repository, '/pulls', {
    method: 'POST',
    body: JSON.stringify({
      head: input.head,
      base: input.base,
      title: input.title.trim(),
      body: input.body ?? '',
      draft: Boolean(input.draft),
    }),
  });
}
