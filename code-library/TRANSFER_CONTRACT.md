# Exact Library Transfer Contract

This contract defines the desired mechanical operation for copying a Sentient Standard Library source file into a target repository without model-regeneration of the source bytes.

## Operation
`materialize-library-module`

## Required inputs
- module id and version
- source repository, exact 40-character commit SHA, path, and expected Git blob SHA
- target repository, branch, and path
- target precondition: `absent` or exact existing blob SHA
- optional lockfile path, default `.user/library-lock.json`

## Guarantees
1. Resolve the source at the exact commit, not a movable branch.
2. Reject if the resolved source blob differs from the expected blob.
3. Check the target precondition before mutation.
4. Write the exact source bytes; do not reformat, template, or regenerate them.
5. Update the lockrecord in the same target commit when locking is requested.
6. Return the new target commit SHA, destination blob SHA, and lockrecord state.
7. The caller must reread the target and verify integration.

## Divergence
If a lockrecord exists and the current destination blob does not match its installed_blob, reject mechanical upgrade and return `DIVERGED@.

## Safety
The operation must not execute arbitrary commands from module metadata or the target repository. It is a content-transfer primitive, not a code execution primitive.
