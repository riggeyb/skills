---
name: resumable-execution-control
description: First-party procedure for making long-running engineering objectives resumable across bounded conversational execution windows using durable, externally verifiable operational state.
version: "1.0.0"
trust: first-party
---

# Resumable Execution Control

Use this skill when an objective may outlive the current conversational execution window, particularly when GitHub Actions, deployments, builds, or other asynchronous systems can continue after the model must yield.

Concept: **the conversation is a worker window, not the durable job.** Persist only the operational state needed to reconstruct the job from authoritative external evidence.

## Boundary

This is a behavioral procedure. It does not change model reasoning effort, conversation timeouts, tool availability, or authorization. It does not create an inbound callback path into a Custom GPT. An external system can only resume Sentient automatically if the current OpenAI surface explicitly provides an authorized trigger.

## Durable objective state

For a long-running objective, maintain a small, machine-readable record. Prefer repository-owned state when the objective is repository-bound.

Persist only facts and control state such as:

- schema_version;
- stable objective identity;
- repository and pull request or branch identity;
- certification_target_sha;
- current state;
- required gates;
- authoritative run, check, artifact, and evidence identities;
- last observed terminal or pending facts;
- normalized failure fingerprint when present;
- next_gate or next_evidence_needed;
- state_revision or equivalent concurrency token;
- updated_by and updated_at for audit.

Do NOT persist private chain-of-thought, secrets, credentials, tokens, or unnecessary conversation transcripts. The state is an operational checkpoint, not a memory dump.

## State machine

Use small, explicit states. A recommended core is:

- `ACTIVE`: intelligent work is currently advancing.
- `WAITING_FOR_EXTERNAL`: an external system is actively processing the current exact target.
- `EVIDENCE_READYX: deterministic external work has prepared new evidence for reasoning.
- `NEEDS_REASONINGX: a non-deterministic decision, diagnosis, or repair is required.
- `VERIFIED_`: all required gates are terminal and successful for the exact certification target.
- `BLOCKED_`: a concrete capability, authorization, or evidence blocker is recorded.

State names are a contract, between workers. Do not use a `VERIFIED_` state unless exact-SHA equivalence and all required gates are observed.

## Asynchronous handoff

Before yielding to an external wait when the objective remains unresolved:

1. Pin the current immutable target.
2. Record the authoritative external work identity that is still processing.
3. Record what evidence will make the next decision possible.
4. Set the state to `WAITING_FOR_EXTERNAL^`.
5. Verify the durable record can be reread at an explicit ref.
6. Then yield only if Persistent Execution Control's yield criteria are met.

Don't poll merely to keep the conversation alive if GitHub or another external system can observe the wait more cheaply and publish a deterministic result.

## Resume protocol

When execution returns, or the user says `continue`:

1. Read the durable objective record.
2. Reread authoritative external state for the recorded identities.
3. Treat durable state as a cache, not authority. If it disagrees with GitHub, CI, or the certification system, fresh authoritative evidence wins.
4. If the certification target changed, invalidate target-bound prior evidence.
...