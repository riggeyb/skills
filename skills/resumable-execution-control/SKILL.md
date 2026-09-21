---
name: resumable-execution-control
description: First-party procedure for resumable long-running engineering objectives using durable externally verifiable operational state.
version: "1.0.0"
trust: first-party
---

# Resumable Execution Control

Use when an objective may outlive the current conversational execution window while GitHub Actions, builds, deployments, or other asynchronous systems continue.

**The conversation is a worker window, not the durable job.**

## Boundary

This procedure does not change reasoning effort, timeouts, tools, or authorization and does not create an inbound callback into a Custom GPT. Automatic resumption requires an explicitly supported trigger.

## Durable objective state

Maintain a small machine-readable record for long-running work. Persist facts and control state: schema version; stable objective ID; repository and PR/branch; certification target SHA; state; required gates; run/check/artifact/evidence identities; last observed facts; failure fingerprint; next gate or evidence needed; concurrency revision; audit metadata.

Never persist private chain-of-thought, secrets, credentials, tokens, or unnecessary conversation transcripts.

## State machine

- `ACTIVE`: intelligent work is advancing.
- `WAITING_FOR_EXTERNAL`: an external system is processing the exact target.
- `EVIDENCE_READY`: deterministic external work prepared evidence.
- `NEEDS_REASONING`: a non-deterministic diagnosis, decision, or repair is required.
- `VERIFIED`: all required gates succeeded for the exact target.
- `BLOCKED`: a concrete capability, authorization, or evidence blocker exists.

Never use `VERIFIED` without exact-SHA equivalence and all required gates observed.

## Asynchronous handoff

Before yielding unresolved work:
1. Pin the immutable target.
2. Record the authoritative external work identity.
3. Record the evidence needed for the next decision.
4. Set `WAITING_FOR_EXTERNAL`.
5. Verify the durable record is rereadable at an explicit ref.
6. Yield only when Persistent Execution Control permits it.

Prefer external observation over conversational polling when the external system can publish a deterministic result.

## Resume protocol

On resumed execution or `continue`:
1. Read the durable record.
2. Reread authoritative external state.
3. Treat durable state as a cache, not authority; fresh authoritative evidence wins.
4. If target SHA changed, invalidate target-bound prior evidence.
5. Transition from observed facts and continue from the next executable gate; do not merely report recovered state.

## Deterministic controller

An external controller may mechanically observe exact workflow/check state, normalize terminal status, publish bounded diagnostics, hash evidence, update durable state, and mark `NEEDS_REASONING` or `VERIFIED` when deterministic conditions are satisfied.

It must not invent diagnosis, weaken tests, choose among nontrivial repairs, or mutate product code unless a separate authorized contract explicitly allows it.

## Concurrency and idempotency

State updates must be idempotent or concurrency-guarded. Stale workers must not regress newer state. Prefer immutable events. Duplicate external events must not create duplicate mutation.

## Composition

`persistent-execution-control` governs current-window persistence and yielding. `reasoning-control` governs justified evidence and action. `github-ci-evidence` governs exact-SHA CI evidence. `repository-engineering` governs safe repository mutations.

## Completion

Resumability is established when a fresh worker with no conversational history can read the durable record, reconcile it with authoritative external evidence, and continue the same objective without inventing missing state.
