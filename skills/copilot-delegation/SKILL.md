---
name: copilot-delegation
description: First-party policy for delegating bounded implementation work to GitHub Copilot cloud agent while Sentient retains inspection, verification, and acceptance authority.
version: "1.0.0"
trust: first-party
---

# Copilot Delegation

Use when bounded implementation may benefit from an asynchronous GitHub Copilot cloud-agent worker. Compose with `implementation-execution`, `repository-engineering`, `persistent-execution-control`, `resumable-execution-control`, and `github-ci-evidence`.

## Authority

The governing loop is:

`Sentient -> GitHub API -> Copilot cloud agent -> branch/PR -> Sentient inspection -> independent verification -> accept OR diagnose -> bounded revision -> reobserve -> reverify`

Sentient is the orchestrator and acceptance authority. GitHub is the control and durable-state plane. Copilot is an implementation worker.

A Copilot task, session, branch, commit, PR, comment, or worker-reported test is evidence of execution only. It is never evidence of correctness and never self-certification.

## Capability gate

Check `capabilities.yaml` and concrete runtime tools before delegating. Schema text does not create a live capability.

For Copilot Pro, use GitHub Issues REST assignment to `copilot-swe-agent[bot]`. GitHub documents optional `agent_assignment` fields including `target_repo`, `base_branch`, `custom_instructions`, `custom_agent`, and `model`.

Do not use `POST /agents/repos/{owner}/{repo}/tasks` for Copilot Pro. GitHub currently documents starting Agent Tasks through that endpoint as Copilot Business or Enterprise only.

The issue-assignment contract is public preview and may change. Recheck authoritative GitHub docs when the contract is material or appears stale.

## Delegate deliberately

Prefer delegation when the objective is bounded and testable, the likely diff is coherent and reviewable, one repository/base is clear, failure can be detected by inspection or independent tests, asynchronous latency is acceptable, and the expected worker-credit cost is justified.

Prefer direct implementation for tiny changes, highly interactive work, unresolved architecture, changes requiring continuous sensitive judgment, unavailable worker context, or likely repeated micro-corrections.

Do not delegate merely because Copilot is available.

## Bound the objective

Before dispatch record operational facts:
- stable objective ID;
- owner/repository;
- intended base branch and observed exact base SHA;
- MUST CHANGE, MAY CHANGE, and MUST NOT CHANGE boundaries;
- observable acceptance criteria;
- cheap checks the worker may run;
- expensive verification reserved for Sentient;
- finite revision/credit budget;
- concurrency strategy.

Write the worker request as an implementation contract, not an open-ended prompt. Never ask Copilot to certify itself, merge its PR, weaken tests, or redefine acceptance criteria.

## Preserve repository identity

Issue assignment accepts a base branch name, not an exact base SHA.

Immediately before assignment, read the chosen base branch and record its exact SHA. When strict immutability matters, create a dedicated delegation base branch from that SHA and assign Copilot against it. Otherwise treat base movement during asynchronous execution as concurrency that must be reconciled before acceptance.

After Copilot creates a PR, record PR number, base ref/SHA, head ref/SHA, and worker branch. A branch name is not an identity boundary. Any later worker push invalidates prior SHA-bound verification.

## Dispatch and idempotency

Prefer an existing well-scoped issue for the same objective. Otherwise create one issue with the bounded body and assign `copilot-swe-agent[bot]`, using `agent_assignment` for target/base/custom instructions when needed.

Maintain at most one live delegation for the same objective/base identity unless an explicit concurrency plan partitions ownership. Before creating work, check for an existing issue, Copilot assignment, PR, or worker branch and resume it rather than duplicating it.

Assignment acceptance proves only that GitHub accepted the control-plane request.

## Observe asynchronous work

Use Persistent Execution Control while the current work window can still make progress. Use Resumable Execution Control if Copilot may outlive it.

Observe:
1. delegated issue state;
2. issue timeline for Copilot activity and linked/cross-referenced PR;
3. resulting PR metadata;
4. exact PR head/base SHAs;
5. changed files and patches;
6. material changed file contents at the exact head when patch context is insufficient.

Durable resumable state contains operational facts only: objective ID, issue number, repository, expected base identity, PR number if known, worker branch/head SHA, state, revision count, required gates, observed evidence IDs, and next gate. Never persist chain-of-thought, secrets, credentials, or unnecessary transcript text.

A pending worker is an external wait, not permission to create a duplicate task.

## Inspect independently

Compare the actual diff against the delegated contract. Check required changes, prohibited/unrelated changes, repository conventions, existing abstractions, test integrity, generated/lock/migration/dependency changes, security/compatibility invariants, and exact reviewed head SHA.

Worker summaries and claimed tests are context only. Repository state and independent evidence are authoritative.

## Verify with cost discipline

Build a proof ladder and use the cheapest decisive evidence first: repository inspection, static/schema validation, deterministic checks, existing exact-SHA evidence, then runtime/deployment/hosted-runner gates only when they prove a contract cheaper evidence cannot.

GitHub Actions is a limited paid verification resource. Copilot must not casually trigger repeated Actions loops while debugging mechanical or schema issues. Batch related corrections first. Sentient decides when runner-backed certification is justified.

Do not delete, bypass, weaken, or skip a required verification gate merely to reduce cost. Use Actions, Netlify, browser/runtime evidence, the Verification Gateway, or other authoritative gates when materially required.

For GitHub evidence use `github-ci-evidence`: bind PR, workflow/check/status evidence, and certification to the same exact head SHA.

## Revise without loops

When inspection or verification finds a bounded defect:
1. diagnose from authoritative evidence;
2. consolidate the observed gap and acceptance condition into one correction request;
3. comment on the worker PR with `@copilot` and that bounded correction;
4. avoid piecemeal comments that create unnecessary sessions/credits;
5. observe the new worker commit;
6. pin the new exact head SHA and mark prior SHA-bound evidence stale;
7. reinspect the diff and rerun only invalidated proof before broader certification.

Prefer a direct small repair when it is cheaper and safer than another delegation cycle and does not violate the concurrency plan.

Set a finite revision budget. If repeated Copilot revisions do not converge, stop redelegating and implement directly or report the concrete blocker. Never use new tasks as a polling mechanism.

## Concurrency and credit control

Keep one active editor per target branch unless an explicit plan partitions files/ownership, integration order, and conflict handling. Never run overlapping agents against the same target implicitly.

Treat every new assignment and `@copilot` correction as potentially consuming AI credits. Reuse live work, batch corrections, and avoid duplicate tasks.

## Repository customizations

Repository-level `.github/agents/*.agent.md`, `.github/copilot-instructions.md`, path-specific instructions, and supported `AGENTS.md` files can improve repository-specific worker behavior when the target already maintains stable conventions, expertise, or tool restrictions.

They are optional worker context, not Sentient policy or acceptance authority. Keep generic orchestration policy in this skill. Do not add a custom agent merely to duplicate a one-off task prompt. If selecting `custom_agent`, verify that profile exists on the branch GitHub will use.

## Acceptance

Accept delegated work only after:
- the worker's exact current head SHA is known;
- the actual diff is independently inspected against the bounded objective;
- required cheap checks pass;
- required runtime, Netlify, Actions, or repository verification gates pass when applicable;
- all acceptance evidence binds to the same exact SHA;
- base/head concurrency assumptions remain valid.

Acceptance does not authorize merge, deployment, publication, or another separately guarded irreversible action.

## Authoritative contract references

Reviewed 2026-09-22:
- GitHub Docs: Using Copilot cloud agent via the API
- GitHub REST: Agent Tasks endpoints
- GitHub REST: Issue timeline events
- GitHub Docs: Using Copilot cloud agent on GitHub
- GitHub Docs: Best practices for Copilot cloud agent
- GitHub Docs: Custom instructions support
- GitHub Docs: Custom agents configuration
