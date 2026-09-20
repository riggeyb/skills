---
name: reasoning-control
description: First-party runtime control for scaling deliberation, evidence convergence, bounded polling, and continuation behavior on complex tool-driven work.
version: "1.0.0"
trust: first-party
---

# Reasoning Control

Use this skill when work is multi-step, consequential, evidence-dependent, asynchronous, or when the user asks to think longer, investigate deeply, continue an ongoing engineering task, or wait for external evidence.

This skill changes behavioral procedure. It does not claim to change the model's product-level reasoning-effort setting. If a higher reasoning-effort setting is available in the product, that setting remains a separate runtime control.

## Depth gate

Classify the task before acting:

- `simple`: one bounded read or transformation with no meaningful side effects.
- `multi-step`: several dependent observations or actions where an early mistake can invalidate later work.
- `consequential`: repository writes, deployments, publication, destructive actions, or externally visible state changes.
- `evidence-convergent`: completion depends on asynchronous or eventually consistent evidence such as CI, workflow runs, deployments, indexing, remote branch movement, or third-party processing.

Use proportionally deeper planning for each higher class. Do not turn a complex task into a sequence of shallow one-probe turns.

For `multi-step`, `consequential`, or `evidence-convergent` work, establish internally before the first mutation:

1. the concrete desired end state;
2. the current authoritative state;
3. unresolved gates and dependencies;
4. evidence that will prove each gate;
5. what observations would invalidate the current plan;
6. the next smallest action that materially advances the end state.

## Continuation semantics

When the user says `continue`, `keep going`, `proceed`, or equivalent during an active task, interpret it as authorization to continue toward the already established objective within existing authorization boundaries.

Do not interpret continuation as "perform exactly one probe and return."

Within the current turn, continue through all safe, useful, currently executable steps until one of these is true:

- the requested objective is verified complete;
- a user decision or new authorization is genuinely required;
- a concrete capability is unavailable;
- a consequential action is outside existing authorization;
- bounded observation has been exhausted and the remaining state is genuinely pending.

Do not stop merely because one observation says `pending` if additional justified observation, diagnosis, or verification is available now.

## Evidence convergence loop

For asynchronous or eventually consistent systems, use:

`pin target -> enumerate evidence -> observe -> classify -> diagnose/repair or poll -> independently verify`

### Pin target

Record the exact identity being evaluated: commit SHA, run ID, deployment ID, artifact digest, resource version, or equivalent.

Never certify a moving label when an immutable identity is available.

### Enumerate evidence

Before polling, state internally what evidence must converge. Examples:

- remote branch head equals target SHA;
- CI run `head_sha` equals target SHA;
- required jobs completed successfully;
- expected artifact exists and is tied to the same run;
- post-write reread matches the intended result.

Do not substitute nearby evidence from an older SHA or similar run.

### Observe and classify

Classify every observation as one of:

- `PASS`: required evidence positively supports the gate.
- `FAIL`: evidence positively contradicts the gate.
- `PENDING`: authoritative system says work is incomplete.
- `STALE`: source is behind a more authoritative/current source.
- `UNKNOWN`: evidence cannot currently establish state.

Resolve contradictions by authority, identity, and freshness. Do not choose the convenient observation.

### Bounded polling

When the environment supports repeated observation and the task is `evidence-convergent`, poll within the current execution budget rather than returning after the first pending result.

Polling must be bounded. Prefer provider-supported wait/retry mechanisms. Otherwise use a small finite number of observations appropriate to the expected latency and tool budget.

Between polls:

- preserve the pinned immutable target;
- avoid mutations that would invalidate the target;
- do not blindly repeat calls that are failing for a non-transient reason;
- use returned run IDs or resource IDs when available rather than broad rediscovery.

If the runtime cannot wait or perform meaningful repeated observations, report that limitation and the last authoritative state. Never pretend background monitoring continues after the response.

## Failure before mutation

A failed check is diagnostic evidence, not an automatic instruction to edit code.

Before any repair mutation answer internally:

1. What exactly failed?
2. Is the failure tied to the pinned target?
3. Is it a code/configuration defect, an expected trigger condition, stale evidence, transient infrastructure, permissions, or an observation limitation?
4. Will the proposed mutation actually address that class of failure?
5. What evidence will become obsolete after the mutation?
6. What new immutable target must be certified afterward?

If those questions do not justify a mutation, keep investigating instead of changing code.

## Mutation invalidates certification

Any mutation that changes the evaluated object creates a new certification target.

For repository work:

- pin the branch head before evaluation;
- after a commit, record the new exact SHA;
- discard CI conclusions tied only to the prior SHA as certification evidence for the new SHA;
- restart the necessary evidence convergence loop for the new SHA.

Historical evidence may still explain behavior, but it does not certify a different commit.

## Think-before-write gate

Before a consequential write, establish:

- why the write is necessary;
- the smallest intended change;
- source/precondition identity;
- expected resulting state;
- rollback or conflict behavior when relevant;
- post-write verification.

Do not mutate merely to create activity, retrigger CI, refresh a stale UI, or avoid waiting for authoritative evidence.

## Repository and CI specifics

When repository work depends on CI or GitHub state:

- prefer exact commit SHA over branch-name inference;
- distinguish workflow trigger rules from workflow correctness;
- check whether the changed paths/events can actually trigger the workflow before expecting a run;
- distinguish PR synchronization, push, manual dispatch, and bot-generated commits;
- do not treat a green run for an older head as certification of a newer head;
- when UI and API disagree, prefer the source that exposes immutable identity and fresher authoritative state, and label the other observation stale rather than silently mixing them;
- diagnose failed jobs before editing implementation;
- after a fix, certify the new SHA from the beginning.

## Investigation budget

Spend effort where uncertainty and consequence are high.

For complex engineering tasks, prefer a small number of well-chosen parallel or sequential reads that answer distinct questions over repeated shallow status checks. Re-read authoritative state after important mutations or surprising observations.

Stop investigation when additional observations are unlikely to change the next safe action. Do not prolong simple tasks merely to appear thorough.

## Reporting

Report the furthest verified state reached, not merely the last action attempted.

Separate:

- verified facts;
- unresolved gates;
- actions performed;
- mutations not performed;
- exact immutable identities when relevant.

Use `PENDING` only after exhausting currently useful bounded observation. Use `UNKNOWN` when the evidence interface itself cannot establish the state.

Never imply that polling or work continues after the response unless an actual asynchronous/background capability was invoked.

## Completion criterion

A complex tool-driven task is complete only when the requested end state is supported by the required evidence, or when a concrete blocker has been identified after proportionate investigation.

Activity, a successful API request, an old green check, or a single pending observation is not completion.
