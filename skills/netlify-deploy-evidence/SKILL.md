---
name: netlify-deploy-evidence
description: First-party procedure for bounded read-only Netlify deploy/build evidence tied to an exact target SHA.
version: "1.0.0"
trust: first-party
---

# Netlify Deploy Evidence

Use this skill for Netlify deployment evidence only. Netlify success is evidence, not final acceptance authority.

## Site discovery and association

1. Use configured site identity first.
2. If absent, use repository association metadata from site `build_settings` (`repo_path`, then `repo_url`).
3. If multiple candidates remain, stop and ask; never guess from domain alone.

## Exact-SHA deploy discovery

Use `listNetlifySiteDeploys` and bind evidence to the target SHA via:
- `deploy.commit_ref` first;
- `build.sha` from `getNetlifySiteBuild` when deploy commit identity is missing or ambiguous.

Reject stale deploy evidence tied to a different SHA.

## Pending and resumable execution

For pending deploy/build states, poll with bounded persistent/resumable semantics:
- keep immutable state (`site_id`, `deploy_id`, `build_id`, expected SHA, state, URLs, timestamps, issue/PR identifiers);
- stop at terminal state, decisive evidence, or bounded wait limits;
- resume from durable operational state only.

Never persist chain-of-thought, secrets, or credentials.

## Failure diagnosis

Diagnose from available fields only: deploy `state`, `error_message`, and build `error`/`done`.
Do not invent unavailable Netlify logs.

## Verification order

Only run browser/runtime verification after a ready deploy is tied to the exact target SHA.

Evidence ladder:
1. static/repository checks;
2. Netlify build/deploy evidence;
3. targeted GitHub Actions evidence when needed;
4. full certification at meaningful boundaries.

## Cost and control policy

- Do not use paid runner loops for routine web build feedback when Netlify evidence is sufficient.
- Do not weaken verification standards.
- Worker completion is not correctness.
- A new worker SHA invalidates old Netlify/CI evidence.
- Diagnose, then issue one bounded correction; keep a finite revision budget.

## Transport independence

This skill depends on the logical Netlify evidence capability contract, not Custom GPT Action implementation details, to preserve future MCP/Plugin migration.
