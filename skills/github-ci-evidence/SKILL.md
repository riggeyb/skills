---
name: github-ci-evidence
description: First-party procedure for exact-SHA GitHub CI inspection, evidence classification, trigger diagnosis, and repair decisions.
version: "1.0.0"
trust: first-party
---

# GitHub CI Evidence

Use this skill when repository work depends on pull-request state, GitHub Actions runs or jobs, check runs, commit statuses, or deciding whether CI evidence certifies an exact commit. Combine it with `reasoning-control`; combine with `repository-engineering` before any repair mutation.

## Evidence target

Pin the exact commit SHA before interpreting CI. Branch names and PR numbers locate work; they are not certification identities.

Establish, when relevant:

- PR head SHA and base SHA;
- current branch head SHA;
- workflow run `head_sha`;
- check-run commit identity;
- combined-status SHA.

If these disagree, classify evidence by identity before interpreting success or failure.

## Evidence hierarchy

Use the narrowest authoritative evidence that answers the question:

1. commit/check/status evidence bound directly to the target SHA;
2. workflow runs whose `head_sha` exactly equals the target;
3. jobs belonging to those exact runs;
4. PR metadata for current head/base identity and merge state;
5. branch state for current moving-head identity.

Do not treat a green workflow, job, check, or status from another SHA as certification.

Checks and legacy commit statuses are separate GitHub mechanisms. Inspect both when repository policy or observed evidence makes both relevant; do not assume one subsumes the other.

## Inspection procedure

For a target SHA:

`pin SHA -> inspect PR/branch identity -> enumerate exact-SHA runs/checks/statuses -> inspect relevant jobs -> classify required evidence`

Prefer exact filters such as `head_sha` when available. Once a run ID is known, inspect that run or its jobs directly rather than repeatedly rediscovering broadly.

For each required signal classify:

- `PASS` - completed evidence positively satisfies the requirement for the target SHA.
- `FAIL` - completed evidence positively violates it.
- `PENDING` - authoritative evidence exists but is not complete.
- `ABSENT`  - no matching evidence was found where evidence may legitimately not have been created.
- `STALE`  - evidence belongs to a different SHA or superseded run.
- `UNKNOWN` - available interfaces cannot establish the state.

`ABSENT` is not automatically `FAIL`. Diagnose whether a run/check should exist before deciding repair is needed.

## Trigger diagnosis

When expected workflow evidence is absent, investigate trigger semantics before changing implementation.

Distinguish:

- `push`, `pull_request`, `workflow_dispatch`, schedule, and other events;
- branch and tag filters;
- path and path-ignore filters;
- workflow-file presence on the relevant ref;
- bot-generated commits and event suppression;
- PR synchronization versus direct pushes;
- skipped jobs caused by job/step conditions;
- permissions or configuration failures from implementation failures.

A missing run caused by trigger rules is not evidence that the code failed.

## Failure diagnosis

When a run failed:

1. verify its `head_sha` equals the pinned target;
2. identify the failing job(s);
3. distinguish cancellation, timeout, infrastructure, permissions, configuration, test failure, lint/type/schema failure, and expected conditional behavior;
4. inspect the smallest available evidence that discriminates the failure class;
5. mutate only when evidence supports a repository defect that the proposed edit addresses.

Do not retrigger CI by making an unrelated commit.

If logs are unavailable, say what the job metadata establishes and what remains unknown. Do not invent a failure cause from a job name alone.

## Reruns and duplicate evidence

Multiple runs may exist for one SHA. Prefer the newest authoritative attempt for current state while retaining earlier attempts as diagnostic history.

Do not combine a passing job from one run with a failing or missing job from another run into a synthetic green result unless repository policy explicitly defines that composition.

For check runs, account for reruns/superseded attempts. Prefer latest instances when the API filter and repository policy support that interpretation.

## Repair invalidates certification

A repair commit creates a new target SHA.

After mutation:

`record new SHA -> discard prior SHA as certification target -> rediscover exact-SHA evidence -> inspect required jobs/checks/statuses -> certify or diagnose`

Old evidence can explain why the repair was made, but cannot certify the new commit.

## PR and merge evidence

A PR being open, mergeable, or merged is distinct from CI certification.

Before relying on PR state:

- confirm the PR head SHA is the target under evaluation;
- inspect changed files when scope matters;
- keep merge state separate from check/run conclusions.

After merge, record the resulting merge/base commit identity when available. Do not assume the pre-merge head SHA and resulting base-branch SHA are identical.

## Bounded convergence

For pending exact-SHA evidence, follow `reasoning-control` bounded polling. Poll the known run/check rather than broad repository state when possible.

Stop polling when:

 - required evidence converges;
- a failure needs diagnosis or repair;
- the target SHA changes;
- the expected evidence is proven absent due to trigger semantics;
- useful bounded observation is exhausted.

## Reporting

Report exact immutable identities and the furthest supported state. A useful CI report distinguishes:

- target SHA;
- matching evidence found;
- passing, failing, pending, absent, stale, or unknown signals;
- diagnosed failure class when supported;
- whether a mutation was performed;
- whether the current target is certified by the evidence actually observed.

Never call a target certified merely because some CI is green.

## Completion criterion

CI-dependent work is complete only when the required evidence for the exact target SHA has converged, or when a concrete failure, trigger condition, or observation limitation has been established strongly enough to determine the next safe action.
