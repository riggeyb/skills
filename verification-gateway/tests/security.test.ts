import assert from 'node:assert/strict';
import test from 'node:test';
import { signClaims, verifyClaims } from '../lib/security.js';
import type { VerificationClaims } from '../lib/types.js';

const claims: VerificationClaims = {
  v: 1,
  nonce: '7ba17079-81a4-4755-a61c-4ca297c8770f',
  repository: 'riggeyb/example',
  sha: 'a'.repeat(40),
  branch: 'main',
  profile: 'full',
  requestedAt: '2026-09-20T12:00:00.000Z',
  requireExactHead: true,
};

test('signed run ids round-trip', () => {
  const token = signClaims(claims, 'test-secret');
  assert.deepEqual(verifyClaims(token, 'test-secret'), claims);
});

test('tampered run ids fail', () => {
  const token = signClaims(claims, 'test-secret');
  const [body, sig] = token.split('.');
  const tamperedBody = Buffer.from(JSON.stringify({ ...claims, repository: 'attacker/repo' })).toString('base64url');
  assert.throws(() => verifyClaims(`${tamperedBody}.${sig}`, 'test-secret'));
  assert.ok(body);
});
