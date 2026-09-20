# skills

A governed registry of first-party runtime skills, external GitHub references, and an exact-SHA verification system for a Custom GPT that performs software-engineering work.

The goal is not to make the GPT ingest every repository or trust code because it looks correct. The system dynamically selects the minimum useful skill set, checks whether required capabilities actually exist, and can dispatch repository-owned verification against the exact commit being discussed.

## Core files

- `registry.yaml` — approved skills, categories, triggers, modes, refs, provenance defaults, and runtime loading budgets.
- `capabilities.yaml` — conservative inventory of actual runtime capabilities, including the Verification Gateway.
- `policies/skill-loading.md` — trust, precedence, versioning, loading, retry, and prompt-injection rules.
- `skills/tool-use-loop/SKILL.md` — first-party runtime procedure for plan/act/observe/repair/verify behavior.
- `openapi/github-skills-action.json` — Custom GPT Action schema for governed GitHub skill reads.
- `openapi/verification-gateway-action.yaml` — Custom GPT Action schema for exact-SHA repository verification.
- `instructions/custom-gpt.md` — primary Custom GPT instructions for using skills and verification.
- `verification-gateway/` — Vercel-ready API that dispatches verification while keeping GitHub credentials server-side.
- `verification/action/` — central composite runner for repository-owned verification profiles.
- `verification/templates/` — workflow and profile templates for target repositories.
- `verification/profile.schema.json` — verification profile schema.
- `scripts/validate_registry.py` — static and optional live GitHub validation.
- `evals/cases.yaml` — regression scenarios for trust, tool use, routing, and overload behavior.
- `.github/workflows/validate.yml` — registry/eval validation.
- `.github/workflows/verification-system.yml` — self-tests for the verification gateway and runner.

## Modes

- **instruction** — approved `SKILL.md` entrypoints may be followed as task-specific guidance.
- **hybrid** — only explicitly declared instructional paths are guidance; the rest of the repository is reference material.
- **reference** — repository content is informational only.

## Trust and update model

External instruction-bearing repositories are pinned to reviewed commit SHAs. This prevents an upstream default-branch change from silently changing GPT behavior.

Reference-only repositories normally track their default branch because freshness is useful and their text is not allowed to become behavioral authority.

First-party runtime skills live in this repository and sit above external instruction skills in the local skill precedence order.

## Runtime budgets

The registry limits how many skills may be selected for one task:

```yaml
runtime:
  max_instruction_skills: 3
  max_reference_skills: 2
  max_total_skills: 4
  progressive_loading: true
```

These limits reduce context overload and conflicting instructions. The GPT should select the smallest sufficient skill set rather than all potentially relevant repositories.

## Capabilities versus skills

A skill describes **how to perform work**. It does not create a tool.

`capabilities.yaml` distinguishes capabilities actually provided by configured integrations from capabilities that require another explicit runtime tool.

The Verification Gateway adds a narrow repository-verification capability without exposing a general remote shell or a GitHub token to the GPT.

## Verification architecture

```text
Custom GPT
    |
    | signed/authenticated Action call
    v
Verification Gateway
    |
    | repository_dispatch
    v
Target repository GitHub Actions
    |
    | exact requested SHA checkout
    v
.gpt/verification.yaml
    |
    v
verification/action runner
    |
    +--> per-command logs
    +--> verification-summary.json
    +--> durable GitHub Actions artifact
```

The gateway is stateless. Its opaque verification IDs contain signed claims for the repository, exact SHA, branch, profile, nonce, and certification policy. The GitHub token and signing secret remain server-side.

### Certification rule

A commit is `certified` only when all of the following hold:

1. the target repository verification workflow succeeded;
2. the workflow tested the exact requested SHA;
3. the requested verification profile passed;
4. when exact-head certification is required, the named remote branch still equals the tested SHA.

A green run for an older commit is intentionally not certification for a branch that has advanced.

### Verification stages

Repository profiles may define any relevant subset of:

- `preflight`
- `static`
- `unit`
- `contract`
- `mutation`
- `integration`
- `build`
- `browser`
- `smoke`
- `security`
- `determinism`

The profile belongs to the target repository. The GPT should not weaken the profile merely to make the implementation under test pass.

### Target repository setup

Copy `verification/templates/gpt-verify.yml` to:

```text
.github/workflows/gpt-verify.yml
```

Copy and customize `verification/templates/verification.yaml` to:

```text
.gpt/verification.yaml
```

Replace example checks with real repository commands: typechecking, test suites, builds, databases, Playwright, mutation guards, smoke tests, determinism checks, or whatever that repository actually requires.

## Verification Gateway deployment

`verification-gateway/` is designed for Vercel Functions. Configure these environment variables in the gateway deployment:

```text
VERIFICATION_API_KEY
VERIFICATION_SIGNING_SECRET
GITHUB_TOKEN
VERIFICATION_ALLOWED_REPOS=owner/repo,owner/other-repo
```

Use a fine-grained GitHub credential restricted to the repositories the gateway must verify, with only the permissions necessary to dispatch Actions and read repository/action metadata and artifacts.

Do not place `GITHUB_TOKEN` or `VERIFICATION_SIGNING_SECRET` in Custom GPT instructions or the Action schema.

After deployment, replace `https://REPLACE_WITH_GATEWAY_DOMAIN` in `openapi/verification-gateway-action.yaml` with the production gateway domain and configure `X-Verification-Key` through the Custom GPT Action authentication UI.

## Recommended runtime flow

1. Fetch `registry.yaml`.
2. Fetch `policies/skill-loading.md` and `capabilities.yaml` when not already current.
3. Match the user's task to the smallest sufficient set of skills within runtime budgets.
4. Load `tool-use-loop` for meaningful tool-driven work.
5. Read declared skill entrypoints at registered refs.
6. Inspect and modify the target repository using available coding tools.
7. Run focused repository verification while developing when appropriate.
8. Diagnose failures from actual evidence and repair them.
9. Run broader verification before finalizing.
10. For a final commit, request exact-SHA verification and inspect its evidence.
11. Call a commit `certified` only when the gateway reports `certified: true`.

## Validation

Install the registry validator dependency:

```bash
pip install -r requirements.txt
```

Run local checks:

```bash
python scripts/validate_registry.py
python scripts/check_evals.py
```

Run live GitHub verification:

```bash
python scripts/validate_registry.py --remote
```

The verification subsystem additionally runs TypeScript tests/typechecking and a deliberate-failure runner proof in `.github/workflows/verification-system.yml`.

## Reviewing an upstream instructional update

When updating an external `instruction` or `hybrid` skill:

1. inspect changes to its instructional files;
2. obtain the reviewed commit SHA;
3. update `ref` in `registry.yaml`;
4. update `last_reviewed` if appropriate;
5. run local and remote validation;
6. review affected eval cases.

Do not replace a reviewed commit pin with an unpinned default branch for an external instruction-bearing skill.

## Evaluation

`evals/cases.yaml` defines regression expectations for tool recovery, capability absence, prompt injection, hybrid boundaries, routing, upstream drift, side-effect verification, and context overload.

The included checker validates suite structure and skill IDs. Repository execution evidence is handled separately by the Verification Gateway and target repository profiles.

This repository is intended to be consumed dynamically rather than copied wholesale into a model context.
