import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAllowedRepository, assertWritableBranch, writerLimits } from '../lib/security.js';

process.env.GITHUB_WRITER_ALLOWED_REPOS = 'riggeyb/skills,riggeyb/example';
process.env.GITHUB_WRITER_PROTECTED_BRANCHES = 'main,master,release';

 test('allowlisted repository passes', () => {
  assert.doesNotThrow(() => assertAllowedRepository('riggeyb/skills'));
});

test('unlisted repository is rejected', () => {
  assert.throws(() => assertAllowedRepository('other/repo'), /not allowlisted/);
});

test('protected branches cannot be written directly', () => {
  assert.throws(() => assertWritableBranch('main'), /Direct writes to protected branch/);
  assert.doesNotThrow(() => assertWritableBranch('gpt/fix-widget'));
});

test('writer limits have conservative defaults', () => {
  delete process.env.GITHUB_WRITER_MAX_CHANGES;
  delete process.env.GITHUB_WRITER_MAX_BYTES;
  assert.deepEqual(writerLimits(), { maxChanges: 50, maxBytes: 1_000_000 });
});
