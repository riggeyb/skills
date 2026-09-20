---
name: debugging
description: First-party procedure for reproducing software failures, discriminating hypotheses, localizing root causes, and repairing defects with regression proof.
version: "1.0.0"
trust: first-party
---

# Systematic Debugging

Use this skill when software exhibits a failing test, error, crash, incorrect output, flaky behavior, performance regression, or other unexpected behavior whose cause is not already established. Combine with `change-analysis` to trace unfamiliar code, `repository-engineering` for mutation, `test-strategy` for regression proof, and `github-ci-evidence` for remote failures.

## Objective

Move from symptom to demonstrated cause before changing production behavior.

A debugging result should establish:
- the exact observed symptom and environment;
- the smallest useful reproduction;
- the boundary where expected and actual behavior diverge;
- evidence that discriminates plausible causes;
- the root cause at an actionable level;
- the smallest coherent repair;
- a regression check that would fail for the original defect when practical.

Do not treat the first plausible explanation as the root cause.

## Capture the failure precisely

Record the observation before investigating:
- input, trigger, or user action;
- expected behavior;
- actual behavior;
- error, assertion, status, or output;
- relevant runtime, configuration, ref/SHA, and dependency state;
- whether the failure is deterministic, intermittent, or not yet reproduced.

Preserve original failure evidence. Do not overwrite it with later interpretations.

For remote CI, pin the exact commit before diagnosis and use `github-ci-evidence` to distinguish current, stale, absent, and conflicting evidence.

## Reproduce at the smallest useful scope

Prefer the cheapest reproduction that preserves the failure mechanism.

Reduce scope in stages when useful:
1. failing end-to-end or remote observation;
2. integration or component boundary;
3. focused test or command;
4. minimal input or fixture;
5. isolated function or transformation.

A smaller reproduction is useful only if it still demonstrates the same defect. Do not reduce away the behavior being diagnosed.

If reproduction is unavailable, continue from durable evidence such as exact-SHA job metadata, assertions, stack traces, logs, artifacts, or deterministic code paths, and state the limitation.

## Establish the divergence boundary

Trace expected and actual behavior until they separate.

At each relevant boundary compare:
- inputs;
- normalization and validation;
- state and configuration;
- branch or dispatch decision;
- output or side effect;
- error propagation;
- producer and consumer assumptions.

Prefer locating the earliest demonstrated divergence rather than patching the final visible symptom.

## Build competing hypotheses

For non-obvious failures, keep multiple plausible hypotheses until evidence discriminates them.

Useful classes include:
- product logic defect;
- incorrect or stale data;
- contract/schema mismatch;
- configuration or environment;
- dependency/API behavior;
- concurrency, ordering, or timing;
- persistence or cache state;
- test/fixture defect;
- infrastructure or tool failure;
- flaky or nondeterministic behavior.

For each live hypothesis, identify an observation that would make it more or less likely. Prefer one high-information probe over many low-signal inspections.

Do not edit code merely to test a hypothesis when a read-only observation can discriminate it.

## Causal localization

A root cause should explain both the observed failure and why the system reached that state.

Distinguish:
- `symptom` - externally observed incorrect behavior;
- `proximate failure` - immediate operation or assertion that failed;
- `root cause` - earliest actionable defect or violated assumption that produced the failure;
- `contributing condition` - required context that exposed or amplified the defect.

Stop causal descent when the identified cause is actionable within the relevant system boundary and additional ancestry would not change the repair.

## Failure-driven probes

Choose probes by information gain.

Examples:
- compare a passing and failing input;
- inspect the value immediately before and after a suspect transformation;
- verify which branch or handler executed;
- compare producer output with consumer expectation;
- pin dependency or configuration versions;
- rerun only when nondeterminism is itself under investigation;
- inspect nearby tests for encoded contract assumptions.

Avoid random edits, broad logging changes, unrelated dependency upgrades, cache clearing, or retrigger commits as substitutes for diagnosis.

## Flakes and intermittent failures

Do not label a failure flaky merely because a rerun passes.

For intermittent behavior:
- preserve the original failure;
- identify dimensions that vary across attempts;
- inspect timing, ordering, shared state, concurrency, retries, network boundaries, and test isolation;
- use bounded repetition only to estimate reproducibility or discriminate a hypothesis;
- repair the causal race, leak, timeout assumption, or nondeterminism when evidence supports it.

A passing rerun is evidence about intermittency, not proof of correctness.

## Repair selection

Before mutation, state:
- demonstrated cause;
- why the proposed edit addresses that cause;
- contracts that must remain stable;
- regression test or nearest proof point;
- evidence that will become stale after the write.

Prefer repairing the violated invariant at its owning boundary. Avoid compensating downstream patches when the upstream contract can be corrected safely.

Do not weaken assertions, swallow errors, broaden retries, or add fallback behavior solely to make the symptom disappear unless that behavior is the intended contract.

## Regression proof

When practical, establish red-green evidence:
1. a focused regression test or reproduction fails for the original defect;
2. apply the repair;
3. the same evidence passes;
4. run additional risk-based verification for affected contracts.

If the pre-fix state cannot be executed, preserve equivalent failure evidence and state exactly what was and was not demonstrated.

Use `test-strategy` to select broader verification. Use `github-ci-evidence` to certify remote results against the exact repaired SHA.

## When the evidence contradicts itself

Do not choose the convenient observation.

Resolve contradictions by:
- identity: same ref, SHA, input, environment, and configuration;
- freshness: newer evidence after the relevant mutation supersedes stale evidence;
- authority: direct boundary observations outrank summaries or UI labels;
- reproducibility: deterministic observations outrank unexplained one-off outcomes for the same conditions.

If contradictions remain material, keep the diagnosis unresolved and run the smallest discriminating probe.

## Completion criterion

Debugging is complete when the observed symptom is explained by a demonstrated actionable cause, the repair targets that cause rather than only the symptom, the original failure is no longer reproduced under equivalent conditions, and verification covers the regression risk introduced by the change.

If the available interface cannot establish the cause, report the strongest localized conclusion and the exact missing evidence instead of inventing certainty.
