import crypto from 'node:crypto';
import type { VerificationClaims } from './types.js';

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA_RE = /^[0-9a-f]{40}$/i;
const PROFILE_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const BRANCH_RE = /^[A-Za-z0-9._\/-]{1,200}$/;

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function requireApiKey(header: string | string[] | undefined): void {
  const expected = requireEnv('VERIFICATION_API_KEY');
  const actual = Array.isArray(header) ? header[0] : header;
  if (!actual) throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
  }
}

export function assertAllowedRepository(repository: string): void {
  if (!REPO_RE.test(repository)) throw Object.assign(new Error('Invalid repository'), { statusCode: 400 });
  const allowed = requireEnv('VERIFICATION_ALLOWED_REPOS').split(',').map((x) => x.trim()).filter(Boolean);
  if (!allowed.includes(repository)) {
    throw Object.assign(new Error(`Repository is not allowlisted: ${repository}`), { statusCode: 403 });
  }
}

export function validateRequest(input: any): { repository: string; sha: string; branch: string | null; profile: string; requireExactHead: boolean } {
  const repository = String(input?.repository ?? '');
  const sha = String(input?.sha ?? '');
  const branch = input?.branch == null ? null : String(input.branch);
  const profile = String(input?.profile ?? 'default');
  const requireExactHead = input?.requireExactHead !== false;
  assertAllowedRepository(repository);
  if (!SHA_RE.test(sha)) throw Object.assign(new Error('sha must be a 40-character commit SHA'), { statusCode: 400 });
  if (!PROFILE_RE.test(profile)) throw Object.assign(new Error('Invalid profile'), { statusCode: 400 });
  if (branch !== null && !BRANCH_RE.test(branch)) throw Object.assign(new Error('Invalid branch'), { statusCode: 400 });
  if (requireExactHead && !branch) throw Object.assign(new Error('branch is required when requireExactHead is true'), { statusCode: 400 });
  return { repository, sha: sha.toLowerCase(), branch, profile, requireExactHead };
}

function b64url(data: Buffer | string): string {
  return Buffer.from(data).toString('base64url');
}

export function signClaims(claims: VerificationClaims, secret = requireEnv('VERIFICATION_SIGNING_SECRET')): string {
  const body = b64url(JSON.stringify(claims));
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyClaims(token: string, secret = requireEnv('VERIFICATION_SIGNING_SECRET')): VerificationClaims {
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra) throw Object.assign(new Error('Invalid verification id'), { statusCode: 400 });
  const expected = crypto.createHmac('sha256', secret).update(body).digest();
  let actual: Buffer;
  try { actual = Buffer.from(sig, 'base64url'); } catch { throw Object.assign(new Error('Invalid verification id'), { statusCode: 400 }); }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw Object.assign(new Error('Invalid verification signature'), { statusCode: 400 });
  }
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as VerificationClaims;
  if (claims.v !== 1 || !claims.nonce || !claims.repository || !claims.sha) {
    throw Object.assign(new Error('Invalid verification claims'), { statusCode: 400 });
  }
  return claims;
}

export function newClaims(input: ReturnType<typeof validateRequest>): VerificationClaims {
  return {
    v: 1,
    nonce: crypto.randomUUID(),
    repository: input.repository,
    sha: input.sha,
    branch: input.branch,
    profile: input.profile,
    requestedAt: new Date().toISOString(),
    requireExactHead: input.requireExactHead,
  };
}
