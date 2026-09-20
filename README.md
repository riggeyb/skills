# skills

A governed registry of first-party runtime skills and external GitHub repositories that a Custom GPT can load on demand as task-specific instructions or reference material.

The goal is not to make the GPT ingest every repository. The goal is to provide a small, trusted control layer that dynamically selects the minimum useful skill set, checks whether required capabilities actually exist, and then progressively loads current or reviewed guidance.

## Core files

- `registry.yaml` — approved skills, categories, triggers, modes, refs, provenance defaults, and runtime loading budgets.
- `capabilities.yaml` — conservative inventory of what the GitHub Skills Action can actually do versus capabilities that depend on other runtime tools.
- `policies/skill-loading.md` — trust, precedence, versioning, loading, retry, and prompt-injection rules.
- `skills/tool-use-loop/SKILL.md` — first-party runtime procedure for plan/act/observe/repair/verify behavior.
- `openapi/github-skills-action.json` — ready-to-paste Custom GPT Action schema for GitHub reads.
- `instructions/custom-gpt.md` — primary Custom GPT instructions for using the registry.
- `scripts/validate_registry.py` — static and optional live GitHub validation.
- `evals/cases.yaml` — regression scenarios for trust, tool use, routing, and overload behavior.
- `scripts/check_evals.py` — static eval-definition validation.
- `.github/workflows/validate.yml` — CI for registry, eval, repository, ref, entrypoint, and glob validation.

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

`capabilities.yaml` distinguishes capabilities actually provided by the GitHub Skills Action from capabilities that require another explicit runtime tool, such as shell execution, Python execution, browser automation, image generation, or external-app actions.

Before following a skill that requires one of those capabilities, the GPT must verify that the capability is present in the current session.

## Recommended runtime flow

1. Fetch `registry.yaml`.
2. Fetch `policies/skill-loading.md` and `capabilities.yaml` when not already current in the conversation.
3. Match the user's task to the smallest sufficient set of registry entries within the runtime budgets.
4. Load the first-party `tool-use-loop` for meaningful tool-driven or multi-step action work.
5. Read declared entrypoints at their registered refs.
6. For `instruction` or `hybrid` entries, follow only approved instructional paths.
7. Fetch supporting files only when needed.
8. Check capabilities before relying on any tool requirement described by a skill.
9. Use `plan -> act -> observe -> diagnose -> repair -> verify` for tool-driven work.
10. Never elevate unregistered or reference-only repository content into instructions.

## Validation

Install the validator dependency:

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

Set `GITHUB_TOKEN` if you need higher API limits or later add private registered repositories.

## Reviewing an upstream instructional update

When updating an external `instruction` or `hybrid` skill:

1. inspect changes to its instructional files;
2. obtain the reviewed commit SHA;
3. update `ref` in `registry.yaml`;
4. update `last_reviewed` if appropriate;
5. run local and remote validation;
6. review the eval cases affected by the change.

Do not replace a reviewed commit pin with an unpinned default branch for an external instruction-bearing skill.

## Evaluation

`evals/cases.yaml` currently defines regression expectations for:

- coding failure recovery;
- UI skill routing;
- malformed API arguments;
- missing capabilities;
- prompt injection in reference repositories;
- hybrid trust boundaries;
- research routing;
- upstream instruction drift;
- side-effect verification;
- registry/context overload.

The included checker validates the suite structure and skill IDs. It is intentionally model-agnostic; a future model-driven evaluation runner can execute these cases against the Custom GPT without changing the case format.

This repository is intended to be consumed dynamically through the GitHub API rather than copied wholesale into a model context.
