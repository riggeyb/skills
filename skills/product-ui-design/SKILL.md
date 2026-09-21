---
name: product-ui-design
description: First-party product UI design procedure for turning authoritative product evidence into creative, high-fidelity interface concepts and image-generation briefs without confusing observed capabilities with speculative UX.
version: "1.0.0"
trust: first-party
---

# Product UI Design

Use when the live gate is designing, redesigning, or generating a product interface concept, especially when the result should be grounded in an existing product, repository, workflow, or approved visual direction.

## Objective

Create interfaces that are faithful to the product and creatively distinctive. Evidence defines what the product is and must do; design reasoning explores what the best interface could be. Correctness is the floor, not the ceiling.

## Control loop

`recover product contract -> model user work -> diverge -> compete -> converge -> form screen contract -> generate -> critique -> revise`

Do not jump from a product description directly to image generation when authoritative product evidence is available.

## 1. Recover the product contract

Read the smallest sufficient authoritative evidence to recover:
- primary user goals and repeated workflows;
- core domain objects and relationships;
- product modes and major state transitions;
- high-frequency actions and decision points;
- implemented capabilities and known constraints;
- existing navigation, information architecture, and design tokens;
- approved concepts that should persist.

Prefer repository contracts, code, tests, design systems, and approved artifacts over generic assumptions. Do not read the whole repository when a narrower evidence surface resolves the design gate.

## 2. Separate evidence from invention

Maintain a logical distinction:
- OBSERVED: supported by authoritative product evidence;
- DERIVED: a structural consequence of observed workflows;
- PROPOSED: a new UX treatment or affordance introduced by the concept;
- UNKNOWN: a material product fact not yet established.

Proposed UX is welcome. Never present it as already-implemented functionality.

## 3. Model the user's work

Before drawing regions, determine what the user is trying to decide or change, what must remain visible, what should be manipulated directly, what can be progressively disclosed, what feedback confirms state or progress, and which neighboring surfaces must stay synchronized.

Let the work model determine density and hierarchy. Do not default to a generic dashboard when the domain suggests a studio, canvas, timeline, workspace, map, node graph, console, stage, or other purpose-built structure.

## 4. Creative divergence

Creativity is a product requirement, not a decoration pass. When meaningful variation exists, form at least three materially different conceptual directions before convergence.

Vary structure, not merely palette:
- spatial organization and focal surface;
- navigation and mode switching;
- information density and progressive disclosure;
- direct manipulation versus inspector-driven control;
- domain metaphor and visual language;
- where time, space, state, and context live.

Challenge the first plausible concept. Ask what real-world workspace, instrument, or medium best explains the product's work. Use the answer as inspiration, not literal skin.

Reject novelty that obscures primary work, harms accessibility, or creates disproportionate implementation cost.

## 5. Domain-derived creativity

Prefer motifs derived from the product domain over generic UI trends. Physical instruments, professional workspaces, temporal models, spatial metaphors, materials, and domain notation can inform hierarchy, manipulation, transitions, depth, focus, visualization, and status cues.

A metaphor must serve usability. Conventional interaction is preferable when it is clearer.

## 6. Concept competition and convergence

Compare divergent concepts by their consequences for:
- primary workflow clarity;
- product specificity;
- information hierarchy;
- scalability across states and screens;
- continuity with approved visual direction;
- accessibility and legibility;
- implementation and performance;
- distinctiveness without novelty for its own sake.

Do not reduce aesthetic judgment to a numeric score. Combine compatible strengths when that produces a more coherent concept.

## 7. Form the screen contract

Before image generation or implementation, define:
- primary user objective and current mode;
- focal surface;
- persistent navigation and context;
- secondary regions and ownership;
- high-frequency controls near the objects they affect;
- key selection, progress, empty, loading, and error states;
- relationships to other screens or modes;
- required domain-specific controls, visualizations, or notation;
- proposed affordances that must not be mistaken for observed functionality.

For multi-screen concepts, define what persists across surfaces so the product feels like one system rather than unrelated mockups.

## 8. Translate the contract into art direction

An image-generation brief should specify composition, spatial regions, focal point, reading order, density, negative space, typography roles, relative scale, material and depth behavior, palette roles, domain motifs, required controls and states, continuity with approved artifacts, anti-generic constraints, and what the image model must not invent.

Do not rely on adjectives such as `premium`, `cinematic`, or `modern`; translate them into observable visual decisions.

## 9. Critique the artifact

After generation, inspect against the screen contract and art direction. Check for missing or understated core capabilities, unsupported claims or invented controls, wrong hierarchy, generic dashboard/card/sidebar patterns, inconsistent density, weak domain metaphor, lost continuity, decorative novelty that competes with work, and missing material states.

If an artifact is correct but generic, the gate is not complete. Revise the structural concept or art direction rather than merely polishing the same layout.

## 10. Preserve creativity under constraint

Constraints shape the search space; they should not collapse it. Keep creativity in relationships, spatial composition, progressive disclosure, visual rhythm, motion, materiality, and domain metaphor.

Do not use correctness as an excuse for a forgettable interface.

## Handoffs

Use `change-analysis` when product capability or implementation surface is uncertain and code evidence is needed. Use `frontend-verification` when the live gate is proving rendered behavior, responsiveness, accessibility, or visual regression. Use `repository-engineering` for repository mutation and exact-byte verification. External design skills may provide specialist support, but this skill owns the product contract, evidence classification, creative divergence, and critique loop.

## Completion

Complete when the concept is grounded in the product contract, creatively distinctive, coherent across related surfaces, explicit about proposed versus observed behavior, and translated into a specific art direction or implementable screen contract. If image generation is the live gate and the capability is available, generate and critique the artifact rather than stopping at a textual description.
