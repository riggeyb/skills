---
name: change-analysis
description: First-party procedure for tracing requested behavior through a codebase, mapping impact, and planning the smallest coherent implementation.
version: "1.0.0"
trust: first-party
---

# Codebase Change Analysis

Use this skill before non-trivial repository mutation when requested behavior must be traced through existing code, contracts, data, or tests. Combine with `repository-engineering` for writes and `test-strategy` for verification scope.

## Objective

Translate a request into an evidence-based change model before editing.

The model should answer:
- where current behavior enters the system;
- where the relevant decision or transformation occurs;
- which contracts and data shapes cross the boundary;
- what consumes or observes the result;
- which tests already encode the behavior;
- which files must change, may change, and must not change.

Do not begin by guessing files from names alone. Trace from observed entrypoints and references.

## Capture the requested contract

Before tracing code, state the request as observable behavior.

Record:
- input or trigger;
- expected output or side effect;
- important edge cases and failure behavior;
- compatibility constraints;
- explicit negative constraints, including behavior that must remain unchanged.

If the request is ambiguous, inspect the codebase for the existing contract before asking for clarification. Ask only when multiple materially different behaviors remain plausible.

## Trace existing behavior

Use a bounded trace from the nearest observable entrypoint to the durable output or side effect.

Trace when relevant:
1. entrypoint or trigger;
2. routing or dispatch;
3. validation and normalization;
4. core decision or transformation;
5. persistence, network, external-service, or runtime boundary;
6. consumer or presentation;
7. tests that observe the contract.

The trace need not touch every layer. Stop when the behavioral boundary and its consumers are understood strongly enough to plan the change.

## Follow symbols, not just files

When repository interfaces permit, use symbols and references to discover impact:
- functions, classes, methods, components, handlers, and workflows;
- types, schemas, enums, configuration keys, and environment variables;
- API routes, event names, storage keys, and message shapes;
- test names, fixtures, factories, and helpers.

For each important symbol, distinguish definition from usage. A definition shows what a symbol can do; usages show which behaviors must be preserved.

## Boundary and data-shape analysis

At each relevant boundary, identify:
- input and output shapes;
- required versus optional fields;
- defaults and normalization;
- error and exception semantics;
- ordering, idempotency, and retry semantics when relevant;
- backward and forward compatibility.

If a request changes a shape, trace both producers and consumers before changing it.

## Map impact

Classify discovered files:
- `MUST CHANGE` - directly implements or encodes requested behavior;
- `MAY CHANGE` - depends on an implementation choice or regression discovered during verification;
- `MUST NOT CHANGE` - encodes compatibility or negative constraints that must be preserved.

For each `MUST CHANGE` file, state why. If a file cannot be tied to a concrete contract or trace, it should not be in the required set.

## Plan the smallest coherent change

Prefer a change set that is:
- complete for the behavioral contract;
- minimal in unrelated surface area;
- consistent with existing architecture and naming;
- compatible with existing callers and consumers when required;
- testable at the nearest meaningful boundary.

Do not conflate small diff with small risk. A short change to a shared schema, auth boundary, migration, or workflow can have a large impact radius.

## Plan content

A useful implementation plan names actual edit points and proof points. For each step include:
- file or symbol;
- current responsibility;
- required behavioral change;
- dependencies or consumers that must stay consistent;
- verification that directly proves the step.

Plan in dependency order. If a contract must change, update the contract and its direct consumers coherently rather than patching one side and leaving a transitional inconsistency.

## Uncertainty and stopping

Do not pretend the trace is complete when key edges cannot be inspected.

Classify unresolved questions as:
- `material` - different answers would change implementation or verification;
- `non-material` - different answers would not change the next safe action.

Continue investigating non-material uncertainty only when cost is low and evidence is likely to improve the plan. Do not block safe implementation on irrelevant completeness.

## Handoff to implementation

Before the first write, confirm:
- target ref/SHA;
- `MUST CHANGE` set;
- contracts that must remain stable;
- first high-signal verification step;
- evidence that will become stale after mutation.

After mutation, use `repository-engineering` for optimistic concurrency and exact-result verification. Use `test-strategy` to scale verification to observed risk.

## Completion criterion

Change analysis is complete when requested behavior has been traced to concrete edit points, relevant producers and consumers are understood, the required change set is justified by evidence, and the verification plan can discriminate intended behavior from the pre-change state.
