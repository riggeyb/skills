# Sentient Standard Library

Version: 1.0.0

## Purpose
Reuse reviewed source code before regenerating commodity infrastructure.

## Protocol
1. Inspect the target repository first; reuse its compatible equivalent when present.
2. Otherwise read `code-library/CATALOG.yaml`, then only relevant manifests and source.
3. Confirm dependencies, invariants, integration points, and `do_not_use_when` against the target.
4. Prefer exact copy of a compatible module over regeneration. Pin source commit and blob SHA.
5. Make only project-specific integration edits.
6. Reread installed bytes and verify the target at its new exact SHA.

Do not force-fit library code. The current target repository is authoritative.

## Provenance
When practical record module id/version, source repository/commit/blob, destination, and installed blob in `.sentient/library-lock.json`. Local edits make a copy divergent; never overwrite divergence without inspection.

## Transfer
Prefer an exact cross-repository materialization primitive when actually exposed. Otherwise use available read/write primitives while preserving and rereading exact bytes. Never infer a transfer capability merely because separate read and write operations exist.

## Completion
Copying alone is not completion. The installed code must be integrated and verified.
