import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAllowedRepository, assertBranch, writerLimits } from '../lib/security.js';

process.env.GITHUB_WRITER_ALLOWED_REPOS = 'riggeyb/skills,riggeyb/example';

test('allowlisted repository passes', () => {
  assert.doesNotThrow(() => assertAllowedRepository('riggeyb/skills'));
});

test('unlisted repository is rejected', () => {
  assert.throws(() => assertAllowedRepository('other/repo'), /not allowlisted/);
});

test('normal branch names are accepted', () => {
  assert.doesNotThrow(() => assertBranch('main'));
  assert.doesNotThrow(() => assertBranch('gpt/fix-widget'));
});

test('writer limits have practical defaults', () => {
  delete process.env.GITHUB_WRITER_MAX_CHANGES;
  delete process.env.GITHUB_WRITER_MAX_BYTES;
  assert.deepEqual(writerLimits(), { maxChanges: 100, maxBytes: 2_000_000 });
});
