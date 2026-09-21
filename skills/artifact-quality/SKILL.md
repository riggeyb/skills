---
name: artifact-quality
description: First-party procedure for inspecting, questioning, and iterating on produced artifacts until they satisfy the live objective rather than merely exist.
version: "1.0.1"
trust: first-party
---

# Artifact Quality

Use when a task produces an artifact whose quality, completeness, or fidelity cannot be established by the fact that generation or mutation succeeded. Examples include code, documents, designs, images, analyses, research outputs, data artifacts, and configuration.

## Objective

Treat artifact creation as an intermediate state when the user's objective implies quality, fidelity, completeness, or correctness. Complete when the artifact is supported by proportionate direct evidence against the live contract, or when a concrete blocker prevents further useful convergence.

## Control loop

`recover live contract -> inspect artifact -> classify gaps -> decide iteration value -> revise -> reinspect -> complete`

Do not iterate mechanically. Each revision must address a material gap or produce clearer evidence that the artifact satisfies the objective.

## 1. Recover the live contract

Before judging the artifact, recover the still-applicable contract from the user's request, prior turns, authoritative sources, specialist procedures, and any pre-mutation plan. Identify:
- the primary objective;
- explicit constraints and negative constraints;
- material content, behavior, or state that must be present;
- quality attributes that are actually part of the task, not generic polish;
- evidence that can directly test the contract;
- aspects that remain proposed, subjective, or unobservable.

Do not invent a retroactive criterion merely to justify more work.

## 2. Inspect the actual artifact

Inspect the produced result when the runtime provides a concrete observation path. Prefer direct observation over intent, prompt, plan, or tool-success metadata.

Depending on the artifact, inspection may include:
- rereading the resulting file or repository state;
- running a targeted test, validator, type check, or contract check;
- rendering or interacting with a user-observable surface;
- inspecting an image, slide, document, chart, or dataset;
- comparing against an authoritative source, screen contract, schema, or prior approved artifact.

If the runtime cannot observe the actual artifact, do not pretend that it was inspected. Use the strongest available proxy evidence and keep the unobserved quality uncertain.

## 3. Classify gaps

Classify material gaps before revising:
- `CORRECTNESS`: the artifact contradicts a required contract, source, or invariant.
- `COMPLETENESS`: required content, state, coverage, or behavior is missing or understated.
- `FIDELITY`: the artifact is technically plausible but does not represent the intended source, product, or approved direction well.
- `USER-OBSERVABLE`: the result may be internally correct but fails the user-observable outcome.
- `REGRESSION`: the revision breaks a previously satisfied contract.
- `GENERICNESS`: the artifact satisfies basic structural requirements but misses task-specific or product-specific qualities that are material to the objective.
- `UNKNOWN`: the available evidence cannot establish whether the contract is satisfied.

Separate material gaps from mere preferences. Do not revise artifacts endlessly because a different valid choice exists.

## 4. Decide whether iteration has value

Iterate when all of the following hold:
- the gap is material to the live contract;
- a concrete revision can plausibly address it;
- the revision does not require a new user-owned product decision;
- the expected improvement justifies the cost, risk, and latency of another iteration;
- the runtime has an authorized capability path for the revision.

Do not iterate when the artifact already satisfies the contract, the remaining difference is purely subjective, the next step would be speculative without new evidence, or the revision would expand the objective.

## 5. Revise the smallest material surface

Address the earliest or highest-leverage material gap. Preserve parts of the artifact that already satisfy the contract. Avoid unrelated cleanup, redesign, refactoring, or expansion.

Before the revision establish:
- which gap the change addresses;
- why the change should resolve it;
- what previous evidence becomes stale;
- what post-revision observation will prove or disprove the fix.

## 6. Reinspect after revision

A revision invalidates evidence tied to the prior artifact identity or state. Inspect the revised result anew and rerun the material proof that the revision could affect.

If the gap persists, return to classification. Do not continue iterating without a new hypothesis or a new discriminating change.

## 7. Preserve specialist ownership

This skill governs the quality convergence loop; domain skills still define what counts as good. For example:
- `product-ui-design` owns the product contract, creative divergence, screen contract, and design-artifact critique;
- `test-strategy` owns the proof scope for software risks;
- `frontend-verification` owns rendered and interactive frontend evidence;
- `repository-engineering` owns safe repository mutation and exact-result observation.

Use the smallest sufficient composition. Do not load a domain skill merely because it could be useful.

## Completion discipline

Do not equate tool success, file creation, code compilation, image generation, or a single passing check with the whole objective being complete.

Complete when:
- the live contract is satisfied by proportionate direct evidence;
- remaining uncertainty is explicit and does not materially change the completion claim; or
- a concrete blocker prevents further useful convergence.

Report the furthest verified state, any material unresolved gap, and why further iteration was or was not warranted.
