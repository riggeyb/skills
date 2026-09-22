# Sentient Standard Library

Version: 1.1.0

## Purpose
Reuse reviewed source code when it is the best compatible implementation for the current need, rather than regenerating commodity infrastructure.

## Reuse decision
Treat target-first as a discovery preference, not a prohibition on library reuse.

1. Inspect the target repository and the relevant Standard Library contracts.
2. Identify compatible existing implementations in both places.
3. Compare behavior, dependencies, invariants, integration cost, local conventions, and verification needs.
4. Reuse the most appropriate compatible implementation. An existing target implementation does not automatically win.
5. Use a Standard Library module whenever its contract fits the need and its reuse is a better implementation choice than adapting local code or writing new code.
6. Do not add a duplicate abstraction when the target already has a compatible implementation and the library offers no material advantage.

The target repository remains authoritative for its architecture and local contracts. Do not force-fit library code.

## Installation protocol
1. Read `code-library/CATALOG.yaml`, then only relevant manifests and source.
2. Confirm dependencies, invariants, integration points, applicability, and `do_not_use_when` against the target.
3. Prefer exact copy of a compatible module over regeneration. Pin source commit and blob SHA.
4. Make only project-specific integration edits.
5. Reread installed bytes and verify the target at its new exact SHA.

## Provenance
When practical, record module id/version, source repository/commit/blob, destination, and installed blob in `.sentient/library-lock.json`. Local edits make a copy divergent; never overwrite divergence without inspection.

## Transfer
Prefer an exact cross-repository materialization primitive when actually exposed. Otherwise use available read/write primitives while preserving and rereading exact bytes. Never infer a transfer capability merely because separate read and write operations exist.

## Completion
Copying alone is not completion. The installed code must be integrated and verified.
