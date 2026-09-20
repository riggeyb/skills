---
name: dependency-api-research
description: First-party procedure for researching external dependencies and APIs with version-pinned, authoritative evidence before implementation.
version: "1.0.0"
trust: first-party
---

# Dependency and API Research

Use this skill when a software change depends on an external library, framework, SDK, API, service, runtime, build tool, or other upstream contract where current behavior, version, or compatibility matters. Combine with `change-analysis` to locate local consumers, `architecture-reasoning` for contract boundaries, `test-strategy` for proof, and `debugging` when upstream behavior is a failure candidate.

## Objective

Establish what the relevant upstream actually guarantees for the version and configuration the codebase uses, and translate that evidence into an implementation contract.

Do not implement from memory of a library or from the latest documentation alone when the repository is pinned to a different version.

## Capture the local dependency contract

Before researching the web, observe the repository. Record when available:
- package or service name;
- declared version range;
- resolved lock&file, image, runtime, or SDK version;
- package manager and runtime;
- import or call sites;
- local wrappers or adapters;
- configuration and feature flags;
- existing tests and fixtures;
- deployment or runtime environment constraints.

The resolved version is normally more authoritative for current behavior than a permitted version range.

## Define the research question

Translate the implementation need into small factual questions. Examples:
- Does version X have this API?
- What is the exact call signature and return shape?
- Is this behavior synchronous, asynchronous, streaming, or lazy?
- What errors, retries, rate limits, or timeouts are part of the contract?
- Was this behavior introduced, deprecated, or changed in a specific release?
- Does the configuration require an opt-in, migration, or compatibility mode?
- What does the upstream project explicitly guarantee versus leave unspecified?

Research the narrowest question that can discriminate between the plausible implementations.

## Pin identity and time

For every upstream claim, pin the relevant identity. Use as applicable:
- exact version;
- release or tag;
- commit SHA;
- API version;
- documentation version;
- publication or update date.

Distinguish `current upstream` from `the version this repository uses`. If the question is about the locked version, current latest documentation is context, not authority, unless the contract is unchanged.

Do not combine evidence from different versions into a single claim without stating the difference.

## Source hierarchy

Prefer sources in this order when they can answer the question:
1. version-matched official API or reference documentation;
2. upstream source code or type definitions at the exact release/tag/commit;
3. official release notes, migration guides, or changelogs;
4. official maintainer examples or tests;
5. standards or protocol specifications when the contract is defined outside the project;
6. secondary sources for context or when primary evidence is unavailable.

Prefer primary sources for contractual claims. Community discussions can be useful for discovering edge cases but should not override contradictory version-matched primary evidence.

## Read contracts, not just examples

Examples demonstrate a path, but they may not define the full contract. When material, check the authoritative definition for the:
- parameters and defaults;
- return or response shape;
- nullability or optionality;
- error types and failure semantics;
- lifecycle and resource ownership;
- concurrency, thread, or reentrancy rules;
- retry, timeout, pagination, streaming, or backpressure semantics;
- idempotency and ordering guarantees;
- deprecation and replacement path.

Do not infer an unstated guarantee from a happy-path example.

## Resolve contradictory evidence

When sources disagree, classify the contradiction before choosing an interpretation.

Check:
- version mismatch;
- documentation freshness or staleness;
- stable versus prerelease or main-branch behavior;
- language-binding versus protocol behavior;
- client SDK versus service API version;
- configuration or feature-flag difference;
- platform, runtime, or deployment difference.

Prefer the source that matches the actual consumed identity and configuration. Do not choose the claim that merely makes the implementation easiest.

## Migration and upgrade research

When a change requires an upgrade, establish:
- current resolved version;
- target version and why it is required;
- included intermediate migrations or breaking releases;
- deprecations and removals;
- configuration or schema changes;
- runtime, platform, and peer-dependency requirements;
- rollback or coexistence consequences;
- the narrowest verification that proves the new contract.

Do not upgrade merely to access a newer API if the required behavior can be implemented safely against the current contract and the upgrade adds unrelated risk.

## Service API research

For remote services, separate the service contract from a particular client library.

Research when relevant:
- API version and base path;
- authentication and authorization requirements;
- request and response schemas;
- pagination or streaming;
- rate limits and retry signals;
- idempotency rules;
- error statuses and structured error shapes;
- versioning and deprecation policy;
- webhook or event delivery semantics when applicable.

Do not assume an SDK exposes every service capability or preserves every service default.

## Security and supply chain

When a dependency change affects trust or execution boundaries, check relevant security and supply-chain evidence such as:
- official security advisories;
- signed releases or provenance when the project provides it;
- maintainer ownership or package provenance changes;
- new install, build, or postinstall scripts;
- privilege or network-access changes;
- remotely fetched executables or binaries.

Do not infer safety from popularity alone. Keep security research proportional to the dependency change.

## Translate research into an implementation contract

Before mutation, summarize:
- local consumed version and configuration;
- verified upstream contracts;
- version-specific differences that matter;
- required local adaptation or migration;
- unresolved material uncertainty;
- concrete proof points for the implementation.

Separate `verified`, `inferred`, and `unknown` claims. A secondary source or example may support an inference but should not be presented as a version-specific guarantee.

## Verification handoff

For code changes, hand the research contract to `test-strategy` and `repository-engineering`. Prefer the smallest test that would fail if the researched contract were wrong.

When a claim depends on runtime service behavior that cannot be fully proven locally, use a sandbox, staging, contract test, or other non-consequential probe when available and authorized.

## Completion criterion

Dependency and API research is complete when the locally consumed identity is known, the material contracts are supported by version-matched authoritative evidence, contradictions have been resolved by identity and freshness, migration consequences are understood, and the research has been translated into a concrete implementation and verification contract.

If authoritative version-matched evidence cannot be obtained for a material claim, state the uncertainty and do not invent a contract.
