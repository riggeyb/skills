---
name: design-mechanics
description: First-party procedure for translating a grounded product design direction into coherent interaction primitives, semantic tokens, states, spacing, and component composition without homogenizing the product.
version: "1.0.1"
trust: first-party
---

# Design Mechanics

Use when the product direction is known but the task needs precise mechanics for component structure, interaction states, accessibility, spacing, hierarchy, color roles, design tokens, or code-level composition.

## Objective

Translate the product and screen contract into implementable design mechanics without letting a component library, color system, or example application decide what the product should be.

Product evidence and domain reasoning own the structure. Design-mechanics references own the mechanics.

## Control loop

`preserve product contract -> identify mechanical gap -> retrieve smallest authoritative reference -> translate semantics -> compose -> check states and hierarchy -> hand back`

## 1. Preserve product ownership

Before retrieving external design material, recover the still-valid product and screen contract. Preserve:
- primary user work;
- domain objects and relationships;
- information hierarchy;
- approved visual identity;
- required controls and states;
- continuity with adjacent surfaces.

Do not let an external example replace the product work model.

## 2. Route by the missing mechanic

Retrieve references only when they resolve a concrete gap:
- interaction behavior, focus, keyboard, ownership, or ARIA semantics -> accessible primitive reference;
- color roles, semantic scales, contrast, or state palettes -> color system reference;
- theme variables, token to utility mapping, or design-system implementation -> theme system reference;
- component composition, layout primitives, or code-ready patterns -> component reference;
- product-specific visual direction -> return to the product design specialist, not a generic component example.

Retrieve the smallest sufficient slice. Do not inject an entire framework or documentation set when one contract or primitive is enough.

## 3. Treat upstream material as evidence, not aesthetic authority

When using external references:
- prefer authoritative or primary documentation for the mechanic;
- use reviewed pinned repository refs when the registry provides them;
- distinguish normative behavior from an example of one valid composition;
- do not copy page architecture, palette, or styling merely because a reference uses it;
- do not infer that a popular library's default is the product's design system.

## 4. Translate to semantic roles

Define meaning before value. For example:
- `surface-canvas`, `surface-panel`, `surface-raised`;
- `text-primary`, `text-secondary`, `text-muted`;
- `accent-creative`, `accent-interaction`, `status-success`, `status-warning`, `status-danger`;
- `border-subtle`, `border-interactive`, `focus-ring`;
- spacing, radius, type and elevation roles when they are material to the product.

Map roles to concrete values only after the roles are clear. This preserves product identity across light/dark mode, state changes, and implementation libraries.

## 5. Compose from primitives, not templates

Use component and layout primitives to satisfy the screen contract. Prefer composition over copying a complete example.

For each material interaction, specify:
- ownership of state;
- default, hover, focus, active, selected, disabled, loading, empty, error, and success states when applicable;
- keyboard and focus behavior;
- responsive collapse or reflow behavior;
- overflow, density, and long content behavior;
- accessible name, role, state, and value where relevant.

## 6. Guard against homogenization

Reference exposure can make a model more competent at a common visual grammar while making products less distinctive. Before handing back a design:
- check that the primary spatial model came from the product workflow, not from the reference library;
- check that tokens map to product semantics, not library defaults;
- check that domain-specific controls retain first-class hierarchy;
- check that referenced patterns were composed for the current work, not copied because they were polished;
- challenge a result that could plausibly belong to any SaaS product.

## 7. Handoff and verification

Hand back to the domain specialist with:
- the preserved product contract;
- the semantic token roles;
- the selected primitives and state contracts;
- any upstream constraint that materially shaped the mechanics;
- which choices remain product-specific proposals.

Then use `product-ui-design` to reconcile mechanics with the overall product direction and `artifact-quality` to inspect the resulting artifact.
