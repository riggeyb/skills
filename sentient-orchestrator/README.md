# Sentient Orchestrator MVP

This directory contains the first control-plane MVP for Sentient: a GitHub App-driven multi-agent orchestrator that keeps GitHub as the code/PR system of record while moving agent coordination and execution into our own service.

## What this MVP does

- Receives signed GitHub `issue_comment` webhooks at `/api/github/webhooks`.
- Starts work when a new comment contains `@sentient <objective>`.
- Deduplicates webhook deliveries using `X-GitHub-Delivery`.
- Creates shared task state and a shared message stream.
- Runs a planner first, then backend/frontend/tests in parallel, then a reviewer.
- Routes roles to economy/balanced/premium model tiers through a provider-neutral router.
- Lets agents read and append shared messages while work is running.
- Publishes curated progress back to the originating GitHub issue using GitHub App installation authentication.
- Keeps the worker implementation replaceable; the included agents are deterministic demo agents, not paid model calls.

## Local setup

```bash
cd sentient-orchestrator
npm install
npm test
npm run typecheck
```

Run locally:

```bash
export GITHUB_WEBHOOK_SECRET=...
export GITHUB_APP_ID=...
export GITHUB_PRIVATE_KEY='-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----'
npm start
```

The server listens on `PORT` (default `3000`).

Endpoints:

- `GET /healthz`
- `POST /api/github/webhooks`

Set the GitHub App webhook URL to:

```text
https://YOUR_HOST/api/github/webhooks
```

## GitHub App permissions/events

MVP permission:

- Issues: read/write (receive issue-comment tasks and post progress)

Subscribe initially to:

- Issue comments

Future repository context, pull-request creation, and Checks reporting will require additional permissions when those features land. Do not grant them before they are needed.

## Architecture

```text
GitHub comment
    |
signed webhook
    v
Webhook boundary
    |
    v
Orchestrator ---- ModelRouter
    |
    +--> Planner
    |
    +--> Backend ----+
    +--> Frontend ---+--> shared TaskMessage stream
    +--> Tests ------+
    |
    +--> Reviewer
    |
    v
GitHub progress comments
```

GitHub comments are a progress surface, not the internal message bus. The MVP uses in-memory state so the interfaces can settle before persistence is introduced.

## Lead Sentient control surface

The durable worker control plane now supports a task-scoped Lead Sentient. A Lead acquires a fenced leadership lease, assigns bounded work, issues directives, reviews worker handoffs, requests rework, and marks integration ready only after every required assignment is accepted.

Authoritative Lead commands carry a positive leadership epoch. Reacquiring an expired lease advances the epoch, so commands from an earlier lease are fenced even when the same worker becomes Lead again. Assignment targets are task-bound, handoff reviews are bound to the submitted `handoffId`, and cancelled work remains blocking while it is still marked required.

Protocol envelopes are runtime-validated against task, tenant, repository, role, authority, and leadership epoch before any durable Lead mutation is admitted.

## Production gaps intentionally left for the next milestones

1. Replace `InMemoryTaskStore` with Postgres and a durable queue.
2. Replace demo agents with provider-backed model executors and cost accounting.
3. Add ephemeral sandbox workers for repository checkout, edits, tests and builds.
4. Add branch/worktree ownership and file-claim conflict prevention.
5. Add PR creation and GitHub Checks reporting.
6. Add a GitHub Discussion progress sink alongside issue comments.
7. Add retries, dead-letter handling, leases, cancellation and budget enforcement.
8. Add per-installation tenant isolation and encrypted secret storage.

The webhook server must remain lightweight. Long-running model or code-execution work belongs in workers behind a queue.
