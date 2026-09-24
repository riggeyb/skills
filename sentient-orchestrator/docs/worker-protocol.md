# Sentient worker protocol

Protocol `1.0` makes worker identity model/provider-independent. A runtime receives a `WorkerContractV1`, task context, tools, and a model; the contract defines identity, bounded work, explicit authority, resources, budget, completion, and reporting.

## Direct Sentient coordination

Never ask the human operator to relay a coordination message when an authorized Sentient coordination channel is available. Send it directly; escalate to the human only for decisions requiring human authority.

The durable coordination transport uses PostgreSQL as the source of truth. Direct worker messages, active-Lead targets, and task broadcasts preserve task/tenant/repository identity, correlation and optional causation. Delivery is ordered, retryable, and explicitly acknowledged. `DIRECTIVE` and `DECISION` messages are fenced by the authoritative active Lead lease/epoch. Coordination payloads carry structured conclusions, evidence, requests, status, and handoffs only; private chain-of-thought, scratchpads, and hidden reasoning are forbidden.

`src/worker-protocol.ts` is the TypeScript API and validation boundary. `schemas/sentient-worker-contract.v1.schema.json` is the portable contract schema. Validators reject unsupported versions, malformed data, identity/tenant/task/repository mismatches, invalid causal parents, and authority violations before durable state. `negotiateProtocolVersion` accepts only mutually supported versions.

Authority is least-privilege. An empty `authority` list permits no privileged operation even when a corresponding tool is installed. Callers map an operation to an `Authority` and call `assertAuthority` before execution or persistence.

`SentientEnvelope<T>` carries `protocolVersion`, message/task/sender identities, optional recipient, required correlation, optional causation/revision, repository/tenant identity, typed payload, and creation time. Types are FINDING, QUESTION, ANSWER, PROPOSAL, DECISION, DEPENDENCY, BLOCKER, CLAIM, RELEASE, HANDOFF, VERIFICATION, ESCALATION, STATUS, and DONE. Payloads transport operational conclusions/evidence, not private chain-of-thought.

Resource claims identify a tenant-scoped resource and lease. Shared/shared claims coexist; any active exclusive claim conflicts with another active claim on the same tenant/type/id. Released or expired claims do not conflict. Persistence and locking mechanics belong to the control plane.

## Control-plane boundary

Shared identifiers are opaque `taskId`, `workerId`, optional `parentWorkerId`, `tenantId`, `repositoryId`, and `correlationId`. The protocol owns what a worker may do and the semantics of contracts/messages/claims/handoffs. The control plane owns whether/when a worker runs, durable lifecycle transitions, lease persistence, retries, cancellation, and runtime adapters. `STATUS` may report lifecycle state but does not mutate durable lifecycle state.

`BudgetEnvelope` defines assigned maxima (`maxCostUsd`, `maxDurationSeconds`, optional `maxTokens`); the control plane remains authoritative for reservation, enforcement, exhaustion, and cancellation. Shared-interface coordination is recorded in issue #66.
