# Design Implementation

Category: UI/UX implementation orchestration

Version: 1.0.0

## Objective

Translate an approved or existing UI/UX direction into a working, interactive implementation inside the existing product codebase. Preserve both the design contract and the software contract. A rendered screen or successful compile is intermediate evidence, not completion.

## When to use

Use when the objective is to make a design concept, screenshot, image, approved direction, or existing interface interactive using an existing codebase. It should also route for requests to implement, code, or continue a UI/UX concept as a real product interface.

## Core state machine

```text
capture design contract
-> recover implementation contract
-> map design to code
-> classify interactions
-> implement minimal coherent slice
-> run and observe
-> critique visual + behavioral fidelity
-> revise
-> verify affected contracts
-> complete
```

## 1. Capture the design contract

Before coding, identify the minimum set of design facts that must survive implementation:

- primary user work and decision hierarchy
- spatial model and navigation
- durable Design DNA: typographic roles, rhythm, color and surface roles, material, status, provenance, decision language, and recurring motifs
- important interaction states and transitions
- responsive and accessibility expectations
- what is evidence-backed versus proposed

If a reference image and the current product model disagree, do not mechanically copy the image. Use Design DNA Synthesis and Product UI Design to determine which relationships are durable.

## 2. Recover the implementation contract

Inspect the smallest sufficient codebase surface before editing. Recover:

- framework, routing, styling, and component patterns
- current screen and layout ownership
- existing components and primitives that already solve part of the design
- state ownership, data flow, commands, and domain models
- existing interactions and tests
- build, test, run, and render verification paths
- generated or vendored files that must not be hand-edited

Prefer extending existing ownership over introducing a second state model, parallel component system, or detached demo architecture.

## 3. Map design to code

Build a small implementation map before mutation. For each material design region or behavior, map to:

- existing component or module to reuse
- existing component to extend
- new component justified by a missing responsibility
- existing state or command to bind
- new local UI state, only when the behavior is truly presentational
- affected test and verification surfaces

Avoid large new abstractions until the current code proves they are needed.

## 4. Classify every material interaction

Each control or interaction should be classified before it is wired:

- `EXISTING`: real capability and state already exist. Wire the interface to them.
- `DERIVED`: the behavior follows from existing product contracts but needs a new UI composition. Keep the derivation explicit.
- `PROPOSED`: the concept introduces a new product capability. Do not fake implementation. Either implement the product contract with proportionate scope or keep the affordance explicitly prototypal/disabled.
- `UNKNOWN`: insufficient evidence. Inspect before coding.

Never make a control appear operational when it has no homest behavior.

## 5. Implement a minimal coherent slice

Do not translate the concept into a large rewrite by default. Choose the smallest slice that can prove the interactive direction inside the real application:

- preserve existing routes, state ownership, and domain contracts
- reuse project components when they fit the design role
- introduce new presentational components when they clarify ownership
- keep semantic tokens and interaction states coherent
- preserve loading, empty, error, disabled, focus, and keyboard behavior for affected workflows

Avoid disconnected prototypes when the user asked to use the existing code.

## 6. Run and observe

After the first meaningful implementation slice, use the strongest available concrete observation path. Depending on runtime capabilities, that may include:

- build or typecheck
- focused tests
- application run
- browser render
- interaction exercise
- console and runtime error inspection
- responsive viewport inspection
- accessibility and keyboard checks

Capability discovery is mandatory before degrading to a manual verification plan. If direct render or browser observation is unavailable, say which quality claims remain unobserved.

## 7. Critique visual and behavioral fidelity

Do not ask only whether the screen looks similar. Critique the running artifact against both contracts.

Check:

- is the primary work model recognizable?
- do hierarchy, density, rhythm, material, and decision language preserve the design direction?
- do controls have real state transitions and feedback?
- do focus, keyboard, disabled, loading, empty, and error states remain coherent?
- does the implementation use real product state rather than fake interactivity?
- does the new surface still feel like this product rather than a generic component demo?
- are console, runtime, and interaction failures absent or explicitly bounded?

## 8. Revise from evidence

If a material gap is observed, classify it before revising:

- `VISUAL-FIDELITY`: the running implementation loses the design contract.
- `BEHAVIORAL-FIDELITY`: an interaction is missing, fake, or wired to the wrong state.
- `IMPLEMENTATION-FIT`: the change fights the codebase architecture or duplicates existing ownership.
- `RESPONSIVENESS`: the work model breaks at a material viewport.
- `ACCESSIBILITY`: keyboard, focus, semantic, or state behavior regresses.
- `REGRESSION`: previously working product behavior breaks.
- `UNKNOWN`: direct evidence is insufficient.

Revise the smallest material surface, then rerun the evidence affected by that revision. Do not restart the whole interface when a bounded change will do.

## 9. Completion gate

Complete only when the available evidence supports all material claims:

- the implementation is inside the existing product architecture
- material interactions are real or explicitly prototypal, not decorative fakes
- the design contract is preserved or improved where the concept requires change
- affected build/test evidence is passing or a concrete blocker is bounded
- rendered and interaction quality has been directly observed when the runtime provides that capability
- prior certification is not reused after a mutation that invalidates it

## Composition and handoff

This skill does not replace specialists. Load the smallest sufficient set.

- `design-dna-synthesis` owns continuity when a reference interface or image must inform a new implementation.
- `product-ui-design` owns product work model, hierarchy, and creative interface direction.
- `design-mechanics` owns tokens, primitives, states, keyboard/focus behavior, and accessibility mechanics.
- `change-analysis` owns codebase impact and behavior tracing.
- `implementation-execution` owns the general repository mutation and verification lifecycle.
- `frontend-verification` owns browser, responsive, console, and interaction evidence.
- `artifact-quality` owns bounded critique → revise → enspect convergence.

When the user says `continue`, keep advancing the unresolved implementation objective through all safe and useful gates. Do not stop after merely creating files, compiling, or producing the first render.
