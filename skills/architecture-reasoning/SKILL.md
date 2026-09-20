---
name: architecture-reasoning
description: First-party procedure for reasoning about software boundaries, ownership, invariants, coupling, data flow, compatibility, and architectural tradeoffs before non-local changes.
version: "1.0.0"
trust: first-party
---

# Architecture Reasoning

Use this skill when a software change crosses components, introduces a new abstraction, changes a durable contract, or requires deciding where behavior should live. Combine with `change-analysis` to trace the existing system, `repository-engineering` for mutation, `test-strategy` for verification, and `debugging` when architecture is being inferred from a failure.

## Objective

Choose a design that preserves clear ownership and system invariants while minimizing unnecessary coupling and migration risk.

Architecture reasoning should establish:
- the relevant system boundary and actors;
- current ownership of state, decisions, and side effects;
- durable contracts and invariants;
- dependency and data-flow direction;
- the forces that make the change non-local;
- viable design options and their concrete tradeoffs;
- the smallest coherent design that fits the existing architecture;
- migration and verification consequences.

Do not introduce an abstraction merely because multiple files are involved.

## Recover the existing architecture

Prefer evidence from the codebase over architecture inferred from names or conventional patterns.

Trace:
1. entrypoints and external boundaries;
2. components or modules that own decisions;
3. state and persistence ownership;
4. data producers, transformations, and consumers;
5. synchronous and asynchronous side effects;
6. public, durable, or cross-component contracts;
7. tests that encode architectural assumptions.

Distinguish intended architecture from accidental implementation. Repeated usage, stable interfaces, tests, schemas, and explicit documentation are stronger evidence of intent than directory shape alone.

## Identify ownership

For each relevant responsibility, ask:
- who has the information required to make the decision?
- who owns the state being changed?
- who can enforce the invariant?
- who currently exposes the durable contract?
- which layer would need knowledge of another layer if the responsibility moved?

Prefer placing behavior at the narrowest boundary that owns the required information and invariant.

Avoid duplicated policy in multiple consumers when one owning boundary can express it safely. Avoid moving behavior into a shared layer merely to make it reachable.

## State invariants

Write the invariants that the design must preserve before comparing solutions.

Examples include:
- one source of truth for durable state;
- authorization before protected side effects;
- idempotent processing across retries;
- ordering or transactional guarantees;
- backward-compatible serialized shapes;
- deterministic transformation for identical inputs;
- isolation between tenants, requests, or jobs;
- no dependency from a lower-level domain boundary onto presentation concerns.

An architectural decision is stronger when it makes an invariant easier to enforce rather than relying on callers to remember it.

## Map dependencies and data flow

Represent the relevant path as:

`producer -> contract -> transformation/decision -> contract -> consumer`

For each edge, identify:
- direction of dependency;
- data shape;
- ownership;
- error semantics;
- lifecycle and timing;
- compatibility expectations.

Look for hidden reverse dependencies such as callbacks, shared mutable state, global configuration, imports from higher layers, or consumers that know producer internals.

Do not call a dependency problematic solely because it exists. Evaluate whether it makes ownership ambiguous, creates cycles, duplicates policy, or prevents independent change.

## Separate mechanism from policy

Distinguish:
- `mechanism` - reusable capability for performing an operation;
- `policy` - product or domain decision about when, why, or under what constraints to use it.

Keep domain policy near the boundary that owns the domain decision. Keep generic mechanism free of caller-specific rules when practical.

Do not move policy into infrastructure merely because infrastructure is shared.

## Evaluate design options

For non-obvious changes, keep at least two plausible designs long enough to compare them.

Compare concrete consequences:
- invariant ownership;
- coupling and dependency direction;
- compatibility and migration;
- failure modes and recovery;
- concurrency and consistency;
- testability and observability;
- operational complexity;
- change surface;
- reversibility.

Do not score architecture with arbitrary numeric weights. State which constraints each option satisfies or violates and why.

Prefer the simplest option that satisfies the required invariants and foreseeable compatibility needs. Do not optimize for hypothetical scale or reuse without evidence that it affects the current decision.

## Abstraction test

Before creating a new abstraction, identify:
- the repeated or independently meaningful concept it represents;
- the contract it stabilizes;
- which callers become simpler or less coupled;
- what variation it intentionally hides;
- what variation must remain visible.

Reject abstractions that only rename one implementation, merge unrelated responsibilities, or require more knowledge to use than the code they replace.

Duplication can be cheaper than a false shared abstraction when behaviors are likely to diverge.

## Contract changes

Treat public APIs, schemas, persisted data, events, configuration, workflow interfaces, and cross-module types as durable contracts when consumers can depend on them.

Before changing one:
1. enumerate known producers and consumers;
2. determine compatibility requirements;
3. decide whether old and new forms must coexist;
4. define migration ordering;
5. define behavior for mixed-version states;
6. identify rollback consequences.

Prefer additive evolution when independent deployment or persisted old data makes coordinated replacement unsafe.

Do not claim a breaking change is safe merely because current in-repository callers were updated.

## State and consistency

When a design changes state ownership or asynchronous behavior, make consistency explicit.

Determine:
- source of truth;
- write authority;
- read freshness requirements;
- transaction boundary;
- retry behavior;
- idempotency key or deduplication rule when needed;
- ordering assumptions;
- partial-failure recovery.

For distributed or asynchronous paths, identify what can be observed between steps. Do not assume atomicity across boundaries that do not provide it.

## Failure boundaries

Choose where errors are classified, translated, retried, or surfaced.

A lower layer should generally expose errors meaningful to its contract, while a higher owning layer decides product policy such as fallback, user messaging, or whether retry is acceptable.

Avoid swallowing failures at shared boundaries when callers need to distinguish causes. Avoid leaking infrastructure-specific details through durable domain contracts unless that is intentional.

## Migration design

For changes that cannot be atomic, plan explicit intermediate states.

A safe migration may require:
1. introduce a backward-compatible contract;
2. deploy producers or readers that understand both forms;
3. migrate state or traffic;
4. switch ownership or writers;
5. verify convergence;
6. remove compatibility code only after old states are no longer possible.

Each intermediate state must be valid. Do not design a sequence that depends on every component changing simultaneously unless the deployment boundary guarantees it.

## Architectural decision record

For consequential choices, record:
- context and required behavior;
- existing constraints and invariants;
- options considered;
- chosen structure and ownership;
- rejected alternatives and the concrete reason;
- compatibility/migration plan;
- verification and rollback signals.

Keep the record proportional to the decision. A local refactor does not require ceremony; a durable cross-component contract deserves explicit rationale.

## Handoff to implementation

Before mutation, produce a design-to-code map:
- owning component or boundary;
- contracts to add, preserve, or evolve;
- state/data-flow changes;
- `MUST CHANGE`, `MAY CHANGE`, and `MUST NOT CHANGE` files or symbols when known;
- migration ordering;
- highest-risk invariant;
- nearest proof point for each architectural claim.

Then use `change-analysis` to refine concrete edit points if needed and `repository-engineering` for safe writes.

## Completion criterion

Architecture reasoning is complete when the proposed structure has explicit ownership, preserves or intentionally evolves relevant invariants and contracts, has dependency and data-flow consequences understood, handles required migration states, and can be verified through concrete system boundaries.

If evidence is insufficient to distinguish materially different designs, identify the smallest observation or prototype that would discriminate them rather than choosing by preference.
