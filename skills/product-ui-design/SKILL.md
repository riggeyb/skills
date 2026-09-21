---
name: product-ui-design
description: First-party product UI design procedure for turning authoritative product evidence into creative, high-fidelity interface concepts and image-generation briefs without confusing observed capabilities with speculative UX.
version: "1.0.0"
trust: first-party
---

# Product UI Design

Use this skill when the live gate is designing, redesigning, or generating a product interface concept, especially when the result should be grounded in an existing product, repository, workflow, or previously approved visual direction.

## Objective

Produce interface concepts that are both faithful to the product and creatively distinctive. Evidence defines what the product is and what it must do. Design reasoning explores what the best interface could be. Do not collapse one into the other.

## Control loop

``recover product contract -> model user work -> diverge -> compete -> converge -> form screen contract -> generate -> critique -> revise``

Do not skip directly from a product description to an image-generation prompt when authoritative product evidence is available.

## 1. Recover the product contract

Before designing, read the smallest sufficient set of authoritative evidence to recover:
- primary user goals and repeated workflows;
- core domain objects and their relationships;
- product modes and major state transitions;
- high-frequency actions and decision points;
- implemented capabilities and known constraints;
- existing navigation, information architecture, and design tokens;
- previously approved concepts that the user expects to preserve.

Prefer repository contracts, code, tests, design systems, and approved artifacts over generic assumptions. Do not read everything if the current design gate can be resolved from a narrower evidence surface.

## 2. Separate observed capability from proposed UX

Maintain a logical distinction between:
- OBSERVED: supported by authoritative product evidence;
- DERIVED: a structural or interaction consequence of observed workflows;
- PROPOSED: a design treatment or new affordance introduced by the concept.
- UNKNOWN: a product fact that remains materially uncertain.

Proposed UX is allowed. Do not present it as an already-implemented product capability.

## 3. Model the user's work, not just the page

Before drawing regions, model the live work loop:
- what the user is trying to decide or change;
- what must remain visible while they do it;
- what should be manipulated directly;
- what can be progressively disclosed;
- what feedback confirms actions, state, or progress;
- what neighboring surfaces must stay in sync.

Use this model to decide density, hierarchy, and proximity. Do not default to a generic dashboard if the work model suggests a studio, canvas, timeline, workspace, map, node graph, console, or other domain-specific structure.

## 4. Creative divergence

Creativity is a product requirement, not a decoration pass. Before converging on a single layout, form at least three materially different conceptual directions when the task supports meaningful variation.

Vary structural ideas, not only palette or styling:
- spatial organization and primary focal surface;
- navigation and mode switching;
- information density and progressive disclosure;
- direct manipulation versus inspector-driven control;
- domain metaphor and visual language;
- where time, space, state, and context live.

Explicitly challenge the first plausible concept. Ask: if the product were not an app, what real world workspace, instrument, or medium would best explain how it works? Use the answer as inspiration, not literal skin.

Reject creative choices that are merely novel, obscure the primary work, or introduce disproportionate implementation cost.

## 5. Domain-derived creativity

Prefer creative motifs derived from the product's domain over generic trends. Examples of sources include physical instruments, professional workspaces, temporal models, spatial metaphors, materials, and domain-specific notation.

Use domain metaphors to inform:
- hierarchy and composition;
- direct manipulation and feedback;
- transitions between modes;
- depth, layering, and focus;
- data visualization and status cues.

The metaphor must serve usability. Do not force a metaphor where a conventional interaction is more legible.

## 6. Concept competition and convergence

Compare divergent concepts against the product contract. Do not score aesthetic taste numerically. Instead, identify consequences for:
- primary workflow clarity;
- product-specificity;
- information hierarchy;
- scalability across states and screens;
- consistency with approved visual direction;
- accessibility and legibility;
- implementation and performance consequences;
- distinctiveness without novelty for its own sake.

Converge by combining compatible strengths when that produces a more coherent concept. Preserve meaningful alternatives when the user is explicitly exploring directions rather than asking for one resolved concept.

## 7. Form a screen contract

Before image generation or implementation, define the scree contract at the level needed for the artifact:
- primary user objective and current mode;
- primary focal surface;
- persistent global navigation and context;
- secondary regions and their ownership;
- high-frequency controls and their proximity to the objects they affect;
- key states, selection, progress, error, and empty conditions;
- relationships to other screens or modes;
- required product-specific controls, visualizations, or notation;
- proposed affordances that must not be mistaken for observed functionality.

For multi-screen concepts, define the elements that must persist across surfaces so the product feels like one system rather than a set of unrelated mockups.

## 8. Translate the contract into art direction

An image-generation brief should specify:
- composition and major spatial regions;
- visual focal point and reading order;
- density and negative-space behavior;
- typography roles and relative scale;
- surface, material, depth, border, and shadow behavior;
- palette and accent roles, not just color names;
- domain-specific visual motifs;
- required controls, states, and context;
- approved continuity from prior artifacts;
- explicit anti-generic constraints;
- what must not be invented by the image model.

Avoid giving the image model only adjuctives such as `premium`, `cinematic`, or `modern`. Translate these into observable visual decisions.

## 9. Critique the artifact

After a visual artifact is generated, inspect it against the screen contract and art direction. Check for:
- missing or understated core capabilities;
- unsupported product claims or invented controls;
- wrong hierarchy or focal surface;
- generic dashboard, sidebar, card, gradient, or glow patterns that document the product poorly;
- inconsistent dencity or spacing;
- weak domain metaphor;
- loss of continuity with previously approved concepts;
- decorative novelty that competes with the work;
- missing loading, empty, error, selection, or progress states when they are material to the concept.

If the artifact is correct but generic, the gate is not complete. Iterate on the art direction or structural concept instead of merely polishing the same layout.

## 10. Preserve creativity under constraint

Constraints should shape the design search space, not collapse it. When a product has strict contracts, keep creativity in the relationships between elements, spatial composition, progressive disclosure, visual rhythm, motion, materiality, and domain metaphor.

Do not use `correctness` as an excuse for a forgettable interface.

## Handoffs

- Use `skill-routing` when other design or engineering skills compete for the current gate.
- Use `change-analysis` when the product capability or implementation surface is uncertain and code evidence is needed.
- Use `frontend-verification` when the live gate is proving rendered behavior, responsiveness, accessibility, or visual regression.
- Use `repository-engineering` for repository mutation and exact-byte verification.
- Use external design skills as specialist support when their procedure is distinctly useful, but keep the product contract, evidence classification, creative divergence, and critique loop owned by this skill.

## Completion

Complete when the concept is grounded in the product contract, creatively distinctive, coherent across related surfaces, explicit about proposed versus observed behavior, and translated into a specific art direction or implementable screen contract. If image generation is the live gate and the capability is available, generate and critique the artifact rather than stopping at a textual description.
