---
name: frontend-verification
description: First-party procedure for verifying rendered user interfaces, responsive states, interactions, runtime health, accessibility signals, and requirement conformance with direct browser evidence.
version: "1.0.0"
trust: first-party
---

# Frontend Verification

Use this skill when a change affects rendered UI, user interaction, responsive layout, navigation, forms, client-side state, or other behavior that cannot be fully certified by source inspection or a build alone. Combine with `test-strategy` for automated proof, `debugging` for failure localization, and `change-analysis` when UI behavior reflects deeper system behavior.

## Objective

Verify the interface the user can actually observe and operate, not merely that the code compiles.

A verification result should establish:
- the exact build, ref, or dev server being observed;
- user-visible requirements and states that must be proven;
- route, viewport, auth/data state, and other preconditions;
- direct rendered evidence for each material claim;
- interaction evidence for behavioral claims;
- runtime and console health;
- responsive and accessibility risks relevant to the change;
- a clear PASS, FAIL, or PENDING classification.

Do not treat a successful build, typecheck, or unit test as proof that rendered UI is correct.

## Pin the observed target

Before interacting with the UI, identify what is actually running.

Prefer a deployment bound to an exact commit SHA, a local server started from an exact worktree/ref, or another immutable preview identity. If the running target cannot be linked to the intended source, do not certify it as exact-version proof.

Record the initial route, viewport, session/auth state, feature flags, and data preconditions that materially affect the observation.

## Define the observable contract

Translate acceptance criteria into observable claims before browsing. For each claim identify its precondition, user action if any, expected visible or behavioral outcome, failure signal, and nearest authoritative observation.

Do not expand the contract into unrelated design preferences.

## Visual inspection

Inspect rendered states relevant to the change. Check for missing, overlapping, clipped, or off-screen content; unintended overflow; broken spacing or hierarchy that changes usability; unreadable or truncated text; missing loading, empty, error, success, disabled, or selected states; stale or duplicated content; and unexpected layout shifts during interaction.

Use screenshots or other direct rendered evidence when the available capability supports it. A screenshot certifies only the state and viewport it captures.

## Interaction verification

For user-driven behavior, perform the actual interaction when browser capability supports it. Verify clicks, keyboard/focus behavior, navigation, forms, async loading, overlays, stateful controls, and other material interactions.

Verify the observed post-condition, not merely that an input event occurred. Do not perform unauthorized consequential actions merely to test a UI.

## Responsive verification

When responsiveness is material, verify relevant viewport classes: narrow/mobile, breakpoint-sensitive intermediate widths, and wide/desktop. Prefer widths near actual breakpoints when transition behavior is the risk, and inspect both sides of a suspect breakpoint when necessary.

Required content should remain reachable and usable without unintended horizontal scrolling.

## Runtime health

Inspect browser console and runtime errors when the capability exposes them. Classify findings as blocking, relevant, or incidental. Do not ignore a new relevant console error because the page appears correct, and do not fail an unrelated change solely because the environment has documented pre-existing noise.

## Accessibility signals

When interactive or semantic UI changes, verify the nearest relevant signals available to the runtime: keyboard reachability and focus order, visible focus when material, semantic role/name, labels and error associations, overlay focus/dismissal/restoration, meaningful reading/navigation order, and usability at narrow or zoomed states when in scope.

Do not claim full accessibility compliance from a limited browser gut-check. State the signals actually verified.

## Visual regression evidence

When a baseline exists and the change is visually sensitive, compare like-for-like states: same viewport, route, deterministic data, theme, and settled state. Classify differences as intended, regression, or unexplained.

Pixel difference alone is not proof of a product defect when dynamic content or rendering variance can explain it.

## State coverage

Do not verify only the happy path when the change materially affects other states. Consider loading, empty, populated, error, disabled/permission-denied, selected/active, success/complete, stale/refreshing, and slow or partial response states when relevant and reasonably reachable.

Use a risk model; avoid broad click-through testing without a reason.

## Evidence hierarchy

For frontend claims, prefer:
1. direct observation of the correct running target in the required state;
2. reproducible browser automation bound to that target;
3. component/integration tests exercising the rendered contract;
4. static source/configuration inspection;
5. build success alone.

Lower-level evidence can support a claim but should not override contradictory direct runtime observation for the same target and state.

## Failure diagnosis

When verification fails, preserve the failing state and emitted errors. Classify whether the failure is product behavior, test/fixture, environment, stale target, or tool failure. Use `debugging` to locate the earliest actionable divergence. Repair the cause, not the verification, when product behavior is wrong, then restart verification from the new build/ref.

Do not weaken an acceptance criterion solely to make verification pass.

## Result classification

Use:
- `PASS` - all material observable claims have direct evidence at the correct target and no blocking or relevant unexplained runtime failure remains;
- `FAIL` - authoritative observation contradicts a material claim or a relevant runtime defect blocks required behavior;
- `PENDING` - required direct eridence cannot yet be observed because the target, state, data, or capability is not yet available.

Do not use `PENDING` to hide a known failure. If the available interface cannot establish a material claim at all, state the exact missing capability or evidence.

## Completion criterion

Frontend verification is complete when the running target is identified, material user-visible and behavioral claims have been exercised at relevant states and viewports, runtime failures have been resolved or classified, and the result is supported by direct browser evidence rather than implementation intent.

When browser automation or visual inspection is unavailable, use the strongest available automated proof and state exactly which frontend claims remain unobserved.
