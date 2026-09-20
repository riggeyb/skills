import crypto from 'node:crypto';

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH_RE = /^[A-Za-z0-9._\/-]{1,200}$/;
const SHA_RE = /^[0-9a-f]{40}$/i;
const PATH_RE = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[\x20-\x7E]{1,500}$/;

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function requireApiKey(header: string | string[] | undefined): void {
  const expected = requireEnv('GITHUB_WRITER_API_KEY');
  const actual = Array.isArray(header) ? header[0] : header;
  if (!actual) throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
  }
}

export function allowedRepositories(): string[] {
  return requireEnv('GITHUB_WRITER_ALLOWED_REPOS').split(',').map((x) => x.trim()).filter(Boolean);
}

export function assertAllowedRepository(repository: string): void {
  if (!REPO_RE.test(repository)) throw Object.assign(new Error('Invalid repository'), { statusCode: 400 });
  if (!allowedRepositories().includes(repository)) {
    throw Object.assign(new Error(`Repository is not allowlisted: ${repository}`), { statusCode: 403 });
  }
}

export function assertBranch(branch: string): void {
  if (!BRANCH_RE.test(branch)) throw Object.assign(new Error('Invalid branch'), { statusCode: 400 });
}

export function assertSha(sha: string, name = 'sha'): void {
  if (!SHA_RE.test(sha)) throw Object.assign(new Error(`${name} must be a 40-character commit SHA`), { statusCode: 400 });
}

export function assertPath(path: string): void {
  if (!PATH_RE.test(path)) throw Object.assign(new Error('Invalid repository path'), { statusCode: 400 });
}

export function writerLimits(): { maxChanges: number; maxBytes: number } {
  const maxChanges = Number(process.env.GITHUB_WRITER_MAX_CHANGES ?? 100);
  const maxBytes = Number(process.env.GITHUB_WRITER_MAX_BYTES ?? 2_000_000);
  return { maxChanges, maxBytes };
}
