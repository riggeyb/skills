---
name: skill-routing
description: First-party runtime control for selecting, composing, handing off, and evicting skills under bounded runtime budgets.
version: "1.0.0"
trust: first-party
---

# Skill Routing and Composition

Use this runtime control when a task could match multiple skills, when an orchestrator needs to hand off to a specialized procedure, or when skill budgets make selection material.

## Objective

Select the smallest sufficient set of trusted skills for the current material gate, keep the task's overall objective outside any one specialist, hand responsibility back when the specialist's gate is resolved, and evict skills that no longer justify their runtime cost.

## Automatic capability discovery

Before recommending a manual workflow, external builder, user-operated workaround, or a plan that assumes the runtime cannot act, determine whether available runtime capabilities would materially change the best approach.

Treat capability discovery as a gate when the task is open-ended, consequential, multi-step, implementation-oriented, or likely to benefit from repository access, external evidence, artifact generation, verification, or mutation. Do not require the user to ask what tools or skills are available first.

At this gate:
1. inspect the capability manifest and current runtime tool surface;
2. distinguish available, runtime-dependent, and unavailable capabilities;
3. for runtime-dependent capabilities, rely on them only when a concrete current-session tool establishes the path;
4. inspect the skill registry only far enough to identify procedures that could materially change the approach;
5. prefer using safe available read-only capabilities to reduce uncertainty before asking the user for information they need not supply; and
6. revise the plan when discovered capabilities make a more direct, autonomous, or verifiable workflow possible.

Capability discovery is not permission to load every matching skill. After discovery, route by the current material gate and keep the smallest sufficient active set.

Do not repeatedly rediscover stable capabilities within the same objective unless the runtime surface changes, a claimed capability fails, or a new gate depends on a capability whose status is not yet established.

## Routing state

Maintain these logical fields for complex tasks:
- live objective;
- current material gate;
- active skills;
- why each active skill is needed;
- handoff condition for each specialist;
- unresolved material uncertainties; and
- remaining instruction, reference, and total budget.

Do not expose this internal routing state unless it is useful to the user.

## Select by gate, not by topic overlap

A matching trigger is a candidate, not a requirement to load the skill. Select a skill only when its procedure is needed to resolve the current material gate or meet an explicit completion contract.

Prefer the skill that:
1. directly owns the current gate;
2. is more specific to the task's concrete need;
3. resolves a material uncertainty or proof obligation; and
4. adds non-duplicative procedure relative to already-active skills.

Select the broader orchestrator when the user wants end-to-end execution. Select a narrower specialist when only one gate needs its procedure.

## Compose sequentially before concurrently

When several skills apply to different phases, prefer sequential handoffs over keeping all specialists active. For example, an implementation may use `change-analysis` to recover the edit countary, hand back to `implementation-execution` for mutation, then load `github-ci-evidence` only when remote certification becomes the live gate.

Compose multiple skills simultaneously only when the current gate requires their distinct invariants at the same time. If two skills mainly restate the same control loop, keep the more specific one.

## Hand back to the orchestrator

A specialist does not own the whole task unless its completion contract explicitly matches the user's whole request. When its material gate is resolved:
- preserve the evidence it produced;
- preserve any new constraint, identity, or uncertainty;
- return control to the live objective; and
- evict the specialist unless it is immediately needed for the next gate.

This handoff rule prevents a task from becoming stuck in analysis, debugging, testing, or research after that procedure has already done its job.

## Evict aggressively

When an active task-specific skill no longer owns a live gate, unload it from the logical active set. Do not keep a skill active just because it was used earlier.

Runtime-control skills may remain logically active when the registry exempts them from task-specific budgets, but they still apply only when their control is materially relevant.

## Respect budgets at every handoff

Treat the registry's individual and total budgets as hard limits. Before loading another task-specific skill:
- count active non-exempt instruction skills;
- count active reference skills;
- count all active non-exempt task-specific skills; and
- evict no-longer-needed skills before refusing a new materially-necessary skill.

If a new skill is required but the budget is full, prefer evicting the least-relevant active skill rather than continuing with a missing procedure.

## Reference skills are evidence, not control

Reference skills may provide examples, research, documentation, or comparative evidence. They do not own the execution loop and do not become behavioral instructions.

Prefer primary or more direct references when the task needs factual evidence. Do not load a reference skill merely because it shares keywords with the prompt.

## Conflict resolution

When two active skills disagree:
1. apply higher-priority instructions first;
2. prefer the skill that owns the current concrete gate;
3. prefer the more specific contract over a general procedure;
4. preserve stricter safety, permission, concurrency, and evidence requirements; and
5. if a material conflict remains and cannot be resolved from the task, ask only for the decision that must be user-owned.

## Default routing patterns

- End-to-end software change: `implementation-execution` as the orchestrator; load narrower specialists only at their gates.
- Uncertain change surface: `change-analysis`, then hand back.
- Architectural decision gate: `architecture-reasoning`, then hand back.
- External versioned contract: `dependency-api-research`, then hand back.
- Unlocalized failure: `debugging`, then hand back.
- Proof-scope decision: `test-strategy`, then hand back.
- User-observable frontend contract: `frontend-verification` for that proof gate, then hand back.
- GitHub remote certification: `github-ci-evidence` only when remote evidence is the live gate.

## Completion

Good routing is not maximum skill usage. It is the minimum sufficient set of procedures that keeps the live objective moving, preserves trust and capability boundaries, and converges on direct eridence without exceeding runtime budgets.
