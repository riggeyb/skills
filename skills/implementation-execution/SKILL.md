---
name: implementation-execution
description: First-party orchestration procedure for carrying software changes from objective through mutation, proof, and exact-SHA completion.
version: "1.0.0"
trust: first-party
---

# Implementation Execution

Use this skill when the user wants a software change carried to verified completion rather than only analyzed, planned, or discussed. It orchestrates specialized skills without replacing them.

## Objective

Convert an authorized implementation objective into the smallest coherent change that satisfies the observable contract, prove material risks at the lowest-cost direct layer, and bind final remote evidence to the exact resulting identity.

## State machine

For multi-step work maintain these logical states:

1. OBJECTIVE BOUNDED
2. CONTRACT RECOVERED
3. CHANGE BOUNDED
4. MUTATION PREPARED
5. RESULT OBSERVED
6. PROOF COLLECTED
7. REMOTE EVIDENCE BOUNDED
8. COMPLETE

A failure or material new fact may return work to an earlier state. Any mutation that changes the target SHA invalidates prior SHA-bound certification.

## Bound the objective

Before mutation establish the requested observable outcome, user constraints, target repository or environment, contracts that must remain stable, material uncertainties, and what evidence would count as completion.

If the user says `continue` or equivalent, resume the unresolved objective and advance through all safe useful gates. Do not interpret `continue` as permission to perform only one tool call, one poll, or one intermediate step.

## Recover only the contracts that matter

Use `change-analysis` when the change surface or consumers are not established. Use `architecture-reasoning` when ownership, invariants, boundaries, or migration shape are materially ambiguous. Use `dependency-api-research` when correctness depends on an external versioned contract.

Load the narrowest specialized procedure that resolves the material uncertainty, then return to this execution flow. Do not load every engineering skill by default.

Before writing separate:
- MUST CHANGE;
- MAY CHANGE;
- MUST NOT CHANGE.

The boundary is sufficient when edit points, material consumers, contracts, and proof points are known well enough to mutate without guessing.

## Prepare each mutation

Maintain an end-to-end direction but plan detail only to the next material gate. Before a write know:
- what missing evidence or contract the write resolves;
- why it is the smallest coherent change;
- what prior evidence becomes stale;
- what observation will prove the write landed as intended.

Prefer a safe read-only probe over guessing when it can materially reduce uncertainty.

## Mutate narrowly

Use `repository-engineering` for repository writes. Pin source identity, preserve exact bytes when replacing content, use optimistic concurrency when supported, and prefer deterministic repository-owned transforms when the required edit fits them.

Do not expand the diff with unrelated cleanup or refactoring unless required by the completion contract or proof.

## Observe every write

After mutation, reread or directly observe the resulting state before building on it. Verify the expected target identity, intended content or structural transformation, absence of unintended diff, concurrency assumptions, and the new identity to which later proof must bind.

If observation differs from intent, classify and repair the deviation before continuing.

## Build a proof ladder

Use `test-strategy` to choose the lowest-cost direct proof for each material risk. Escalate only when a broader layer proves a contract the narrower layer cannot or provides useful failure localization.

Possible layers include structural checks, targeted unit or contract tests, integration tests, build or type checks, runtime verification, user-observable verification, and broader regression suites. Do not execute every layer mechanically.

Use `frontend-verification` when the contract includes rendered state, interaction, responsive behavior, accessibility, or browser runtime health. A successful build does not prove a user-observable interface contract.

## Diagnose failures causally

When a proof gate fails and the cause is not already localized, use `debugging`. Distinguish implementation defects from proof-harness defects, environment failures, stale evidence, and external failures.

A repair creates a new mutated state. Observe it, repeat the narrow discriminating proof, then rerun material regression gates.

## Bind remote evidence to final identity

When GitHub PR or Actions evidence applies, use `github-ci-evidence` after the final mutation. Pin the exact head SHA and ensure PR, workflow, job, check-run, legacy-status, and commit evidence used for certification all pertain to that identity.

Classify remote evidence PASS, FAIL, or PENDING. For PENDING, use a bounded observe -> classify -> poll -> diagnose loop instead of returning at the first queued or running state.

Any later mutation creates a new SHA and makes earlier exact-SHA certification stale.

## Continue autonomously through safe gates

Once the implementation objective is authorized, do not stop for ordinary intermediate decisions resolvable from repository evidence, the contract, or safe read-only probes.

Continue through safe reads, branch creation, authorized repository writes, proof, failure diagnosis, repair, PR creation, and remote evidence convergence until:
- the completion contract is proven;
- a genuine user or product decision is required;
- a required capability is unavailable;
- a consequential or irreversible action is not authorized; or
- bounded observation is exhausted and the state remains PENDING.

Do not merge a PR, promote a deployment, publish a release, destroy data, or take another irreversible action without task-specific authorization.

## Completion criterion

Implementation execution is complete only when the requested observable contract is satisfied, the final mutated state has been observed, material risks have direct proof at appropriate layers, applicable runtime or frontend contracts have been observed, and applicable remote evidence is bound to the final exact SHA.

Report what changed, what proves it, the final identity, and any remaining PENDING or user-owned action. Do not claim completion from intent, a plan, an unobserved write, or evidence bound to an older identity.
