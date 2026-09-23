# Sentient worker protocol

Protocol `1.0` makes worker identity model-independent: a runtime receives a `WorkerContract`, task context, tools, and a model. The contract defines identity, scope, permissions, resources, budget, completion, and reporting.

`src/worker-protocol.ts` is the TypeScript API and validation boundary. `schemas/sentient-worker-contract.v1.schema.json` is the portable contract schema. Validators reject unsupported versions, malformed data, identity/tenant/task mismatches, unknown causal parents, and authority violations before durable state. `negotiateProtocolVersion` selects only explicitly supported versions; adding a future decoder must not silently reinterpret v1 data.

Authority is least-privilege. An empty `authority` list permits no privileged operation, even when a corresponding tool is installed. Callers map an operation to an `Authority` and call `assertAuthority` before execution/persistence.

Messages are typed by `kind` and carry message/task/tenant/sender/recipient/time metadata plus optional correlation, causal parent, and revision SHA. Payloads contain operational conclusions/evidence only. `HANDOFF` payloads have a required structured shape.

Resource claims identify a tenant-scoped resource and lease. Shared/shared claims coexist; any active exclusive claim conflicts with another active claim on the same tenant/type/id. Released or expired claims do not conflict. Persistence/locking mechanics belong to the control plane.

## Control-plane boundary

The protocol assumes durable opaque `tenantId`, `taskId`, and `workerId`, plus optional `parentCoordinatorId`. The control plane owns worker creation, scheduling, lifecycle, persistence, and cancellation mechanics. It should construct contracts, invoke these validators before durable writes/actions, and never infer authority from tools. Coordination issue #68 records this interface so implementations can evolve independently.
