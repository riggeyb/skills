---
name: test-strategy
description: First-party procedure for selecting high-signal tests, proving regressions, and scaling verification with change risk.
version: "1.0.0"
trust: first-party
---

# Test Strategy

Use this skill when software work requires deciding what to test, which tests prove a change, how far to expand verification, or what a failure implies. Combine it with `repository-engineering` for mutations and `github-ci-evidence` for remote CI certification.

## Proof objective

Before running tests, state the behavioral claim that needs proof. Tests are evidence for a claim, not a ritual.

Identify:
- the intended behavior or defect being addressed;
- the closest observable contract that distinguishes correct from incorrect behavior;
- plausible regression surfaces created by the change;
- the highest-consequence failure that must not escape verification.

Do not use "all tests passed" as a substitute for defining what the tests actually prove.

## Test layers

Choose the lowest-cost layer that directly observes the risk, then add outer layers only when they prove different contracts.

1. **Static/structural checks** - parsing, schema, types, lint, formatting, generated-file consistency.
2. **Unit tests** - deterministic local behavior, edge cases, error classification.
3. **Contract/component tests** - boundaries between modules, APIs, storage, schemas, or adapters.
4. **Integration tests** - real composition of multiple parts where mocks could hide the risk.
5. **End-to-end tests** - critical user journeys or deployed-system boundaries that lower layers cannot prove.

Do not default to the most expensive layer. Prefer the smallest test that fails for the right reason.

## Regression proof

When fixing a defect, prefer a regression test that:
- fails against the defective behavior when practical;
- passes after the fix;
- asserts the public or durable contract rather than implementation accidents;
- is narrow enough that a future failure points back to the same class of bug.

If the exact pre-fix failure cannot be executed in the current runtime, do not claim red-green proof. State what was established instead.

## Risk-based escalation

Scale verification by both change surface and consequence.

Consider:
- number and criticality of changed files;
- public API, schema, migration, or persistence changes;
- concurrency, auth, security, billing, or data-loss risk;
- build, deployment, workflow, or generated-artifact changes;
- cross-cutting shared utilities or dependency upgrades;
- uncertainty about the actual impact radius.

A small local change with a strong unit or contract test may not justify a full end-to-end suite. A small text change to shared workflow configuration can justify broader verification because its blast radius exceeds its diff size.

## Selection procedure

Use this sequence:

`identify claim -> map risks -> find nearest tests -> run high-signal subset -> classify results -> expand only for uncovered risks`

Start with existing tests that directly exercise the changed contract. Add a regression test when a new defect class would otherwise remain unprotected.

Expand when:
- the changed contract crosses an untested layer;
- a passing test does not observe the real risk;
- a failure suggests a wider impact radius;
- shared infrastructure or generated output changed;
- repository policy requires a broader suite.

Stop expanding when identified risks are directly covered and remaining tests primarily repeat already-proven contracts.

## Interpreting failures

A failing test is an observation, not yet a cause.

Before mutating:
1. confirm the test executed against the intended code/configuration or exact SHA;
2. distinguish product defect from test defect, fixture/environment failure, flake, timeout, or infrastructure;
3. reproduce at the smallest relevant scope when useful;
4. inspect the assertion and nearby contract, not only the test name;
5. change production code only when the failure establishes a product defect.

Do not weaken an assertion merely to make a failing test green.

## Passing tests and certification

A passing test certifies only the contract it actually observes.

When reporting verification:
- name the tests or suites run;
- state what behavior each proves;
- separate local verification from remote CI;
- do not infer unrun tests from a green subset;
- do not infer deployed behavior from unit tests;
- do not infer correctness of external services from mocked contracts.

Use `github-ci-evidence` to determine whether remote evidence belongs to the exact commit under evaluation.

## When no test exists

If a behavioral change has no existing test that directly observes it, add the smallest durable regression test when practical.

For pure documentation or non-behavioral metadata changes, do not invent tests that cannot observe a meaningful failure. Use parsing, schema, link, formatting, or repository-specific validation when those are the real contracts.

## Completion criterion

Testing is complete when the chosen evidence directly covers the changed behavior and identified regression risks at appropriate layers, and any remaining untested surface is explicitly understood rather than silently assumed safe.
