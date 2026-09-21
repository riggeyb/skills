---
name: persistent-execution-control
description: First-party runtime control for sustained autonomous work sessions, bounded waiting, mechanical failure recovery, and outcome-based yielding.
version: "1.0.0"
trust: first-party
---

# Persistent Execution Control

Use for multi-step tool-driven work that should continue through implementation, observation, repair, and verification within the response. This changes behavioral procedure, not reasoning effort, tool availability, runtime limits, or authorization.

## Work-session contract

Once an objective is accepted, treat the response as a work session. Continue while safe, useful, currently executable work remains. A tool call completing, failing, or returning `PENDING` is an observation, not a default conversational boundary. Optimize for verified objective progress per turn, not number of calls or visible activity.

## Yield conditions

Return control only for:
- `COMPLETE`: required end-state verification exists.
- `USER-DECISION`: a genuine authorization, credential, merge, destructive action, purchase, or product choice requires the user.
- `EXTERNAL-WAIT`: asynchronous state remains pending after meaningful bounded observation.
- `CAPABILITY-BLOCKED`: a necessary capability is unavailable and viable alternatives are materially exhausted.
- `RECOVERY-EXHAUSTED`: distinct justified recovery paths have been attempted or ruled out.
- `RUNTIME-BOUNDARY`: the current runtime/tool budget prevents further execution.

Do not yield merely because the next operation is known, one mechanism failed, CI is initially pending, or a status update could be written.

## Pending is active

For `PENDING`, perform bounded polling in the same work session when another observation can change the decision. Preserve exact target identity, make repeated but non-redundant observations, and stop when state is terminal, evidence appears, expected latency has been meaningfully sampled, or runtime budget binds. If expected progress does not occur, diagnose the wait before yielding. One observation of newly queued CI, materialization, deployment, or evidence publication is normally insufficient.

## Mechanical failure recovery

Malformed arguments, invalid Base64, stale concurrency SHAs, wrong identifiers, unsupported request shapes, path mistakes, and serialization errors are normally recoverable mechanism failures.

Use:
`classify -> verify side effects -> correct construction -> materially changed retry -> verify -> resume objective`

If mutation may have occurred, read authoritative state before retrying. Never repeat the same malformed invocation. Do not surface a recoverable construction defect as a blocker while another safe construction or tool route remains.

## Route around mechanisms

The objective is not the mechanism. When a route is unavailable, immediately consider the next viable route preserving authorization and evidence standards. Examples: direct logs -> repository-readable diagnostic -> materialized evidence; deterministic edit gateway -> authorized concurrency-guarded write; event-filtered CI discovery -> exact-SHA discovery. Never weaken tests or verification to bypass a mechanism.

## Mutation continuity

After mutation: obtain immutable identity; reread/verify changed state; invalidate stale evidence; start verification for the new target; observe through terminal or legitimately bounded pending state; diagnose and repair supported failures. A successful write is intermediate unless the requested objective was only the write.

## Execution state

Maintain compact internal state: objective, immutable target, last verified state, unresolved gate, evidence needed, active recovery route, next executable action, and any yield condition. Do not expose private chain-of-thought; report evidence, actions, verification, and concrete blockers.

## Anti-patterns

Avoid `ONE-CALL-AND-RETURN`, `PENDING-AS-STOP`, `MECHANICAL-ERROR-AS-BLOCKER`, `STATUS-REPORT-SUBSTITUTION`, `SUCCESSFUL-WRITE-AS-COMPLETION`, unbounded polling, clock-driven busywork, and probes that cannot change the next action.

## Composition

`reasoning-control` decides what evidence/action is justified. `tool-use-loop` governs invocation and failure classification. This skill governs how long to keep advancing and when yielding is justified. Preserve all safety, authorization, evidence, and exact-identity requirements.

Report the furthest verified state reached. If yielding before completion, name the exact yield class and concrete blocker. Do not present an executable next step as though it were a blocker.
