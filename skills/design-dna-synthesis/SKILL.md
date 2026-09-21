---
name: design-dna-synthesis
description: First-party procedure for extracting durable visual and interaction identity from existing UI references and synthesizing it with a current product work model without copying obsolete page architecture.
version: "1.0.1"
trust: first-party
---

# Design DNA Synthesis

Use when an existing interface, mockup, screenshot, design system, or approved visual artifact should inform a newer product direction without becoming a template to copy.

## Objective

Recover what makes the reference recognizably itself, separate that identity from legacy structure or incidental detail, and synthesize the durable identity with the current product contract.

The reference is evidence of an established design language, not proof that every screen, layout, or interaction should persist.

## Control loop

`capture reference -> extract DNA -> classify durability -> recover current product contract -> map continuity -> synthesize -> critique identity -> revise`

## 1. Capture the reference faithfully

Inspect the actual reference when it is available. Do not reconstruct it from memory or from a stylistic label when a direct artifact can be observed.

Capture observable characteristics across:
- typography roles, contrast, and scale relationships;
- color roles and state usage;
- spacing, density, white space, and rhythm;
- line, border, shadow, radius, material, and depth behavior;
- navigation, decision, and approval patterns;
- information notation, metadata, status, and provenance cues;
- domain-specific visual or interaction motifs;
- motion, transition, or progressive-disclosure behavior when observable.

## 2. Extract relationships, not just values

A design DNA is not a hex palette or a list of components. Recover relationships such as:
- oversized editorial headings paired with compact production metadata;
- restrained surfaces punctuated by high-signal accents;
- generous negative space around decisions but dense tooling near direct manipulation;
- version, provenance, and approval cues that make production state feel auditable;
- a recurring decision language that makes user agency visible.

These relationships are more durable than a specific color value, card shape, or page grid.

## 3. Classify durability

For each extracted trait, classify it logically as:
- DURABLE: a recognizable identity relationship that should survive architecture change;
- ADAPTABLEZ an established pattern whose purpose should persist but whose form may change;
- LEGACY: a structural decision tied to an older product model or constraint;
- INCIDENTAL: a detail without sufficient evidence of identity importance;
- UNKNOWN: not enough evidence to classify safely.

Do not preserve a trait merely because it exists. Do not discard a trait merely because it is old.

## 4. Recover the current product contract

Inspect the smallest sufficient current evidence for the product's present work model, core capabilities, modes, domain objects, decision points, and material states.

Distinguish:
- OBSERVED: current product behavior;
- DERIVED: structural consequences;
- PROPOSED: new UX treatments;
- UNKNOWN: product facts not yet established.

The current product contract owns what must be represented. The reference DNA owns how the product can remain recognizably itself.

## 5. Build a continuity map

Before generating a new artifact, map the reference identity into the current product model:
- which durable traits persist directly;
- which traits must be adapted to new surfaces or modes;
- which legacy structures must not be carried forward;
- where new domain capabilities require new hierarchy, density, or interaction;
- what remains uncertain.

Continuity does not require pixel-level similarity. It requires that the new system feels like a credible evolution of the same product.

## 6. Synthesize, do not average

Do not between an old reference and a new workspace by simply averaging their styles. Structure should come from the current work model; identity should inform how that structure is expressed.

Examples:
- an editorial document identity can become a shell and information language around a dense spatial workspace;
- a compact approval language can become a recurring decision strip across new modes;
- an established accent pair can become semantic product roles rather than screen-specific decoration.

Preserve relationships and interaction language before specific layouts.

## 7. Critique identity, not just correctness

After generation or implementation, ask:
- can a recognizable design relationship be traced from the reference into the new artifact;
- is the continuity visible in hierarchy, type, status, decision language, materiality, or rhythm - not only in color;
- did any legacy structure survive without a current product reason;
- is a new surface generic because the reference identity was reduced to palette or type alone;
- have proposed affordances been mistaken for observed capability?

If the artifact is faithful to the current product but does not feel like an evolution of the reference, the identity gate is not complete.

## Handoffs

Use `product-ui-design` to own the current product contract, creative divergence, screen contract, and art direction. Use `design-mechanics` to translate the synthesis into semantic tokens, interaction states, accessibility, and component mechanics. Use `artifact-quality` to govern inspection, revision, and reinspection of the resulting artifact.

## Completion

Complete when the durable and adaptable design traits are explicit, legacy structure is identified and not blindly preserved, the continuity map is consistent with the current product contract, and the new artifact can be critiqued for recognizable identity beyond superficial styling.
