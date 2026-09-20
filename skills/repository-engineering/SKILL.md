---
name: repository-engineering
description: First-party procedure for safe repository mutations using exact source capture, deterministic edit preparation, optimistic concurrency, and independent verification.
version: "1.0.0"
trust: first-party
---

# Repository Engineering

Use this skill for repository mutations such as replacing files, inserting structured entries, applying patches, creating commits, or opening pull requests. Combine it with `tool-use-loop`; this skill specializes the generic tool loop for repository state transitions.

The core rule is: **do not confuse the ability to read, transform, and write independently with the ability to compose those operations safely.** Large or exact-content edits require a concrete transfer mechanism between repository reads, deterministic transformation, and repository writes.

## Capability gate

Before preparing a repository mutation:

1. Check the repository read capability.
2. Check the repository write capability.
3. Check `repository_content_transform` separately.
4. Confirm the concrete tools present in the current runtime actually provide the required handoff.

Do not infer composition merely because repository reads, Python or shell execution, file access, and repository writes are individually available.

If exact source bytes cannot be transferred into deterministic transformation code and the resulting bytes cannot be transferred into the write operation, classify the blocker as an **interface/composition limitation**. Do not manually reconstruct a large file body, weaken verification, or pretend a patch operation exists.

For small edits that can be represented safely without reconstructing unrelated content, use the narrowest supported operation. Otherwise stop before mutation and report the missing composition primitive.

## Canonical mutation lifecycle

Use these evidence-bearing states:

`SOURCE CAPTURED -> EDIT PREPARED -> WRITE CONFIRMED -> RESULT VERIFIED`

These states are distinct. Never report a later state when only evidence for an earlier state exists.

### SOURCE CAPTURED

Capture enough identity to bind the planned edit to one exact source state:

- repository;
- path;
- branch or ref;
- source commit when available;
- current blob SHA or equivalent source-version token;
- exact source bytes or an opaque artifact/file handle that preserves them;
- a content hash such as SHA-256.

For exact-content work, prefer artifact/file handles over routing large payloads through model-generated prose.

### EDIT PREPARED

Prepare the intended result deterministically outside the conversational text channel when possible.

Requirements:

- operate on the captured source bytes;
- preserve encoding and line endings unless the requested change requires otherwise;
- use explicit transformation preconditions;
- reject ambiguous anchors;
- validate syntax and repository-specific schemas;
- inspect the resulting diff;
- ensure unrelated content did not change;
- record the expected result bytes and content hash.

For insertions, an anchor that must be unique is a precondition. Zero matches or multiple matches are failures, not invitations to guess.

The repository helper `scripts/prepare_repository_edit.py` implements byte-preserving unique-anchor preparation and exact-result verification for runtimes that can materialize repository content into files.

### WRITE CONFIRMED

Perform the remote mutation only after the edit is prepared and validated.

Use optimistic concurrency whenever the remote system supports it. For GitHub Contents API updates, send the blob SHA captured from the source read. A conflict or stale source version means the prepared edit is no longer authorized against the current repository state.

Capture mutation evidence such as the resulting commit SHA and blob SHA. A successful write response establishes `WRITE CONFIRMED`; it does not by itself establish `RESULT VERIFIED`.

### RESULT VERIFIED

Independently reread the destination after the write and compare it with the exact prepared result.

Verification should establish:

- the destination contains the expected bytes or expected content hash;
- the relevant semantic validators still pass when available;
- the resulting repository state corresponds to the intended branch/ref;
- no additional mutation is required.

Only then report the repository mutation as verified.

## Conflict handling

If the source version changed between capture and write:

`CONFLICT -> reread -> recapture source -> reconstruct edit -> revalidate`

Do not overwrite the newer source by omitting, weakening, or bypassing the source-version precondition.

A previously prepared result is stale after a source conflict unless its transformation is explicitly proven safe against the new source.

## Unknown write outcome

A timeout, connection failure, or missing write response can leave the mutation outcome unknown.

Use:

`WRITE OUTCOME UNKNOWN -> reread destination -> classify observed state`

- If the exact prepared result is present, continue to `RESULT VERIFIED`.
- If the old source is still present, a retry may be safe after rechecking the source-version precondition.
- If neither state is established, stop and report the unresolved outcome.

Never blindly retry a mutation whose first attempt may already have succeeded.

## Minimal-diff discipline

Before writing, compare the prepared result with the captured source and verify that the diff matches the requested intent.

A byte-for-byte successful upload proves transport fidelity, not edit correctness. The intended-change check is therefore separate from post-write equality verification.

For structured files such as YAML, JSON, manifests, or lockfiles, run the repository's existing parser, schema validator, formatter check, or purpose-built validation command when available.

## Multi-file changes

Prefer one-file edits when that satisfies the task.

When several dependent files must change together, prefer a repository mechanism that can publish one commit from a captured base tree/commit. With GitHub Git Data primitives, the conceptual flow is:

`capture base commit -> prepare all files -> create blobs -> create tree -> create commit -> fast-forward ref -> reread/verify`

Do not expose an invalid intermediate state through a sequence of independent file commits when atomicity is required. If the runtime only supports individual file replacements and partial state would be unsafe, report the capability limitation rather than simulating atomicity.

## Pull-request workflow

For nontrivial mutations, prefer a reviewable branch and pull request unless the user explicitly requires a direct write and that write is safe.

A typical workflow is:

`capture base -> create branch -> prepare edit -> validate -> conditional write -> reread branch -> inspect diff -> open PR`

Creating a PR does not prove the change is correct; preserve the same preparation and verification requirements.

## Reporting vocabulary

Use these terms consistently when they help explain progress:

- **Source captured** — exact source identity and content evidence are available.
- **Edit prepared** — deterministic result exists and pre-write checks passed; no remote mutation is implied.
- **Write confirmed** — the remote system acknowledged the mutation.
- **Result verified** — an independent read confirmed the intended remote state.
- **Conflict** — the source version changed and the prepared edit must be reconsidered.
- **Write outcome unknown** — the mutation may or may not have landed; reread before retrying.

## Completion criterion

Repository mutation work is complete only when the requested state is supported by observed remote evidence, or when a concrete capability/interface blocker has been identified without risking repository integrity.
