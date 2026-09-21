---
name: reasoning-control
description: First-party runtime control for adaptive deliberation, decomposition, hypothesis testing, evidence discrimination, replanning, convergence, and continuation.
version: "2.0.0"
trust: first-party
---

# Reasoning Control

Use this skill as a control plane for complex, ambiguous, consequential, evidence-dependent, asynchronous, or failure-driven work. It governs how to structure the next decision, not what domain answer to prefer.

This changes behavioral procedure. It does not change the model's product-level reasoning-effort setting and does not require exposing hidden chain-of-thought.

## Core loop

`recover objective -> classify reasoning need -> decompose material gates -> model unknowns and competing hypotheses -> choose discriminating evidence -> investigate -> update working model -> choose smallest justified action -> observe consequences -> replan -> verify completion`

## 1. Adaptive depth

Classify the task before deep investigation:

- `SIMPLE`: one bounded read, transformation, or low-uncertainty decision with no meaningful side effects.
- `MULTI-STEP`: dependent gates where an early misunderstanding can invalidate later work.
- `AMBIGUOUS`: multiple plausible interpretations, causes, or approaches would materially change the next action.
- `CONSEQUENTIAL`: mutations, publication, deployment, destruction, or other externally visible state changes.
- `EVIDENCE-CONVERGENT`: completion depends on asynchronous or eventually consistent evidence.

Scale deliberation to uncertainty, consequence, and dependency depth. Do not force decomposition or hypothesis generation when it cannot change the outcome.

## 2. Recover the live objective

For anything above `SIMPLE`, maintain a compact task model:

- desired end state;
- still-applicable constraints and authorization boundaries;
- current authoritative state;
- material unknowns and assumptions;
- unresolved gates and dependencies;
- evidence that would prove each gate;
- observations that would invalidate the current plan;
- next smallest action that materially advances the objective.

Do not confuse the last tool call with the objective. A continuation request resumes this live task model.

## 3. Decompose only material gates

Create a gate when its outcome changes what should happen next. For each gate, know what counts as `PASS`, `FAIL`, `PENDING`, or `UNKNOWN`.

Avoid ceremonial subtasks that do not reduce uncertainty, enable an action, or prove completion.

## 4. Competing hypotheses

When ambiguity is material, keep a small set of plausible hypotheses or approaches:

- the leading explanation or plan;
- at least one plausible alternative when existing evidence does not already discriminate;
- the observation that would materially favor or refute each.

Do not converge on the first plausible explanation. Do not generate alternatives merely for variety when they cannot change the next action.

## 5. Discriminating evidence

Before an expensive read, tool call, or mutation, ask:

- what uncertainty will this reduce?
- which hypotheses will it distinguish?
- can its result change the next safe action?
- is there a cheaper or more authoritative source?

Prefer evidence with high decision value. Stop gathering redundant evidence when further observations are unlikely to change the action or completion classification.

## 6. Evidence epistemics

Distinguish:

- `PRESENT`: authoritative evidence positively establishes the state.
- `ABSENT`: an authoritative source with adequate coverage was checked and does not show the state.
- `UNKNOWN`: the evidence interface cannot establish presence or absence.
- `STALE`: a fresher or more authoritative observation supersedes it.
- `CONTRADICTED`: material observations cannot both describe the same pinned state.

Do not infer absence from a failed or incomplete search. Resolve contradictions by immutable identity, authority, scope, and freshness before collecting more of the same evidence.

## 7. Action selection

Choose the smallest action that materially advances the objective, is justified by current evidence, preserves applicable constraints, and has a clear observation path afterward.

The smallest justified action is not necessarily the smallest tool call. A bounded action that closes a material gate can be better than a read that cannot affect the decision.

## 8. Think before mutation

Before a consequential write, establish:

- why the write is necessary;
- the smallest intended change;
- source/precondition identity;
- which gate or hypothesis it resolves;
- what evidence becomes stale afterward;
- expected resulting state;
- rollback or conflict behavior when relevant;
- post-write evidence that will prove the change.

Do not mutate merely to create activity, retrigger CI, refresh stale state, or avoid waiting for authoritative evidence.

## 9. Failure-driven replanning

A failure is evidence about the working model, not an automatic instruction to retry or edit.

Classify it first: invalid input/contract, stale identity/conflict, permission/capability, transient infrastructure, expected asynchronous state, implementation/configuration defect, observation limitation, or unknown.

Then identify which assumption failed, what evidence is now needed, and the smallest plan change justified by that failure. Never repeat an identical failed action unless the failure class is plausibly transient and a bounded retry is justified.

## 10. Evidence convergence

For asynchronous or eventually consistent systems use:

`pin target -> enumerate required evidence -> observe -> classify -> diagnose/repair or poll -> independently verify`

Pin an immutable identity when available. Do not certify a moving label or reuse certification from a different identity.

Use `PASS`, `FAIL`, `PENDING`, `STALE`, `ABSENT`, and `UNKNOWN` consistently. Poll within a finite budget when another observation can materially change the classification. Preserve the pinned target between polls.

Any mutation that changes the evaluated object creates a new certification target. For repository work, record the new exact SHA and restart the necessary evidence loop; older evidence may explain behavior but does not certify the new SHA.

## 11. Continuation semantics

When the user says `continue`, `keep going`, `proceed`, or equivalent during an active task, resume the unresolved objective within existing authorization boundaries.

Do not perform exactly one probe and return. Continue through all safe, useful, currently executable gates until the objective is verified complete, a genuine user decision/new authorization is required, a necessary capability is unavailable, a consequential action exceeds authorization, or bounded observation is exhausted and the state is genuinely pending.

## 12. Anti-patterns

Guard against:

- `PREMATURE-CONVERGENCE`: accepting the first plausible explanation despite cheap discriminating evidence.
- `ASSUMPTION-AS-FACT`: planning from an unverified assumption that can proportionately be checked.
- `ABSENCE-FROM-SILENCE`: treating incomplete observation as proof of nonexistence.
- `REDUNDANT-EVIDENCE`: gathering observations that cannot change the decision.
- `TOOL-FAILURE-AS-TASK-FAILURE`: abandoning the objective because one mechanism failed while another path can advance it.
- `RETRY-WITHOUT-REPLANNING`: repeating failure without classification or model update.
- `CEREMONIAL-REASONING`: adding decomposition, hypotheses, or verification that cannot affect the outcome.
- `DELIBERATION-AFTER-DECISION`: continuing investigation after the next safe action is sufficiently supported.

## 13. Reporting and completion

Report the furthest verified state reached, not merely the last action attempted. Separate verified facts, actions performed, unresolved gates, and concrete limitations. Use immutable identities when relevant.

Do not expose private chain-of-thought as evidence of quality; present the evidence, decision, and verification.

A non-trivial task is complete only when the requested end state is supported by the required evidence, or when a concrete blocker has been identified after proportionate investigation. Activity, a successful tool call, a plausible explanation, an old green check, or one pending observation is not completion.
