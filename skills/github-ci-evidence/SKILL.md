---
name: github-ci-evidence
description: First-party procedure for exact-SHA GitHub CI inspection, automatic failure-evidence consumption, trigger diagnosis, and repair convergence.
version: "2.0.0"
trust: first-party
---

# GitHub CI Evidence

Use this skill for GitHub Actions, browser/test evidence, check runs, commit statuses, and exact-SHA certification. Combine with `reasoning-control`; use `repository-engineering` before repair mutation.

## Prime directive

Optimize for evidence latency, not weaker evidence. Prefer machine-actionable failure diagnostics that become repository-readable as part of failing CI. Artifact recovery is a fallback.

## Convergence state

Maintain:
- `certification_target_sha`: implementation SHA being certified;
- `diagnostic_source_sha`: SHA that produced the failure;
- workflow run/job/step identity;
- artifact ID/name when retained;
- evidence locator;
- normalized `failure_fingerprint`;
- current hypothesis and next gate.

Never confuse an evidence/bookkeeping commit with the implementation SHA an artifact describes.

## Exact-SHA discovery

Discover CI by target SHA first, not assumed event type:

`pin SHA -> enumerate runs/checks/statuses across relevant events -> inspect exact-SHA runs -> inspect jobs -> classify`

Do not prematurely filter to `push` or `pull_request` unless trigger semantics prove it authoritative. Once a run ID is known, inspect it directly.

## Evidence hierarchy

Prefer:
1. repository-readable SHA-bound machine diagnostic from the exact failing run;
2. direct check/status and job/log evidence;
3. bounded materialized artifact evidence whose manifest binds run + source SHA + artifact identity;
4. artifact metadata;
5. PR/branch metadata for moving-head identity.

Evidence from another SHA cannot certify the target.

## Evidence routing

On failure use the first available decisive route:

`repository-readable diagnostic -> direct job/log -> directly consumable artifact -> materialized artifact -> metadata-only diagnosis`

If one route is unavailable, immediately advance to the next known viable route. Do not return a capability blocker while a proven fallback can advance the objective. A repository's proven push-triggered materializer remains valid when workflow dispatch is unavailable.

## Automatic diagnostic publication

Prefer CI that emits a bounded text/JSON diagnostic in the same failing run and makes it readable through ordinary repository-content primitives. Bind it to immutable identities.

Include when available: schema version, source SHA, run ID/attempt, workflow/job/step, viewport/test identity, normalized error class, failing assertion/locator summary, bounded exception excerpt, console/page errors, screenshot/artifact names and SHA-256 hashes, timestamp, and failure fingerprint.

Keep screenshots as artifacts; make the actionable diagnosis text-readable without ZIP access. Prefer a dedicated deterministic evidence ref/path keyed by run ID and source SHA rather than mutating the feature branch.

## Failure fingerprinting

Compare each failure with the previous diagnostic:
- changed fingerprint after targeted repair: the test advanced; diagnose the new failure;
- identical fingerprint: verify the repair reached the tested SHA and affects the asserted contract before another mutation;
- ambiguous fingerprint: gather the smallest discriminating evidence.

## Trigger diagnosis

If expected evidence is absent, inspect event type, branch/tag filters, paths, workflow presence, bot/event suppression, PR synchronization, conditions, and permissions before changing implementation. Do not make unrelated commits merely to retrigger CI.

## Repair and certification

A repair creates a new target:

`record new implementation SHA -> mark old certification evidence stale -> rediscover exact-SHA evidence -> certify or diagnose`

Old evidence remains diagnostic provenance only.

For `PENDINGa, poll the known run/materialization target within a finite useful budget. Do not perform one observation and return when bounded polling can materially advance the objective.

Prefer evidence publication that does not mutate the feature branch. If a legacy request-file mechanism must move the branch head, retain separate diagnostic and certification identities.

## Reporting and completion

Report immutable identities, furthest verified state, failure fingerprint when useful, action taken, and current certification target. CI-dependent work is complete only when required evidence for the exact target converges, or a concrete blocker remains after all known safe evidence routes and proportionate investigation are exhausted.
