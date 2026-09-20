---
name: director-certification
description: First-party exact-SHA evidence and certification protocol for Director Studio repository work.
version: "1.0.0"
trust: first-party
---

# Director Certification

Use this skill for Director Studio implementation, audit, testing, Previz, integration, promotion, release, mutation guards, or any claim that a specific Git commit passed the authoritative gate.

## Governing rule

Director uses layered evidence to prove both code correctness and Git identity. Do not collapse this into "tests passed."

- Focused/local tests are development evidence.
- The full GitHub Actions gate on the final exact SHA is certification evidence.
- Retained SHA-bound artifacts are inspectable evidence.
- After CI, `CI_SHA == remote_HEAD` is the identity proof.

A green run for an older SHA does not certify a branch that has advanced.

## Five evidence levels

```text
1. Can I safely start from this exact commit?
        ↓
2. Do ordinary unit/contract tests pass?
        ↓
3. Will the tests catch important regressions?
        ↓
4. Does the whole application build/run/integrate correctly?
        ↓
5. Was this exact remote SHA independently certified?
```

Do not treat success at one level as proof of another.

## Checkout-backed preflight

API inspection is not a substitute for a real checkout when establishing starting invariants. The authoritative workflow uses `actions/checkout@v4` with `fetch-depth: 0` and can record:

- `git rev-parse HEAD`;
- `git merge-base --is-ancestor` checks;
- required-file and forbidden-repository scans;
- repository-specific invariants;
- commands, output, exit status, `GITHUB_SHA`, branch, and run ID;
- final `PRECONDITION_RESULT=PASS`.

The durable artifact convention is:

```text
director-precondition-<exact SHA>
```

Prefer exact-SHA checkout-backed preflight evidence over GitHub Contents API inference for consequential work.

## Self-service certification

The authoritative full gate can be requested by a final commit whose message contains:

```text
[director-certify]
```

Use ordinary commits while iterating. For final certification:

```text
final intended commit
→ [director-certify]
→ fresh GitHub Actions checkout
→ full gate
→ inspect jobs and retained evidence
→ refetch branch after CI
→ require CI_SHA == remote_HEAD
```

Never transfer certification between SHAs.

## Ordinary correctness

Use the repository's current workflow as authority for exact commands. The full gate may include syntax/source checks, generated DB client work, Next type generation, TypeScript typechecking, Python compilation, repository verification, Node/TypeScript tests, focused contract suites, token/commercial checks, and Python tests under both `tests` and `worker`.

When both `unittest` discovery and full `pytest` collection are present, treat the duplication as intentional discovery defense unless current repository evidence says otherwise.

## Tests of the tests

A green suite does not prove critical tests are collected or regression-sensitive. For protected invariants, preserve deliberate-break and mutation evidence:

```text
good implementation → tests PASS
deliberately broken invariant → tests MUST FAIL
```

Director mutation guards are regression-sensitivity evidence, not redundant unit tests. Restore temporary mutations before certification.

## Generated-engine determinism

Where Director generates runtime/engine files, prove:

```text
same source → same generated engine
```

The gate may run engine preparation twice, hash generated outputs twice, and require identical hashes. It may also require valid generated shell syntax, no Git diff in generated files, and no changes to frozen engine artifacts. Do not certify a tree that depends on uncommitted/manual regeneration.

## Database integration

Mocks and compilation are not enough for persistence changes. When CI provisions PostgreSQL, use migration and integration jobs to prove upgrade behavior, fresh migrations, persisted storyboard/reference behavior, allowance/profile behavior, token/billing behavior, and cross-boundary database integration.

Migration correctness and behavioral integration are separate evidence.

## Build, smoke, dependency gate

A unit-test-green app may still fail production compilation, startup, or dependency policy. The authoritative gate may separately require:

```text
npm run build
node scripts/smoke_preview.mjs
npm audit --audit-level=moderate
```

Use the current workflow if commands change.

## Browser evidence

Browser-sensitive features require browser evidence separate from unit/DOM tests. Director has used pinned Playwright/Chromium checks at desktop and mobile widths such as 1440px and 400px.

SHA-bound evidence conventions include:

```text
previz-browser-<SHA>
delivery-labels-browser-<SHA>
```

Do not claim source-level Blender tests, fake renderers, or fixture screenshots prove a real Blender render. Evidence must match the capability claimed.

## Exact-SHA certification

The outermost invariant is:

```text
CI head SHA
    ==
final intended implementation SHA
    ==
remote branch HEAD after CI
```

After the authoritative run, re-read the branch. If it advanced, the completed run certifies the old SHA only. If a remote ref advances for reasons the worker did not cause, stop and re-establish the intended tree before making certification claims.

## Future-worker lifecycle

```text
A. Refetch/read current branch
B. Retrieve or verify exact-SHA preflight evidence
C. Require PRECONDITION_RESULT=PASS when applicable
D. Revalidate assumptions against that exact tree
E. Develop
F. Run focused tests during development
G. Create final intended [director-certify] commit
H. Let full Director CI run
I. Inspect jobs and durable artifacts
J. Refetch/read branch after CI
K. Require CI_SHA == remote_HEAD
```

Focused development tests are not authoritative certification.

## Promotion

Certification does not automatically transfer through merges:

```text
certified implementation
→ certified integration merge
→ certified release branch
→ actual main merge
→ certify actual main merge SHA
```

Certify the resulting merge tree when release policy requires that tree itself to be authoritative.

## Audit behavior

When auditing Director history:

- distinguish implementation claims from exact-SHA certification;
- verify branch heads and commit identities directly;
- bind durable artifacts to the run/SHA that produced them;
- do not infer current certification from an older green run;
- distinguish fixtures from live-provider, real-browser, real-database, real-Blender, or other environment-dependent evidence;
- record when implementation exists but production acceptance evidence remains incomplete.

## Capability boundary

This skill describes the evidence protocol; it does not create GitHub Actions, shell, artifact-download, browser, database, Blender, or provider capabilities. Check the registry capability policy and tools actually available. If a required capability is unavailable, identify the missing evidence rather than claiming it was produced.

## Completion

A Director certification claim is complete only when the evidence class matches the claim and the exact Git identity is proven. Do not confuse activity with evidence, or evidence for one SHA with certification of another.
