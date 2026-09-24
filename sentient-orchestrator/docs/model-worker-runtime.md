# Model-backed Sentient WorkerRuntime

`ModelBackedWorkerRuntime` is the provider-neutral execution boundary for automatically spawned Sentient specialists. Sentient identity and Lead authority stay in the existing control plane; provider/model identity is metadata on the execution record, not the worker identity.

## Boundary

```text
AutomaticLeadSupervisor
  -> WorkerStore / WorkerScheduler / WorkerRuntimeReconciler
  -> ModelBackedWorkerRuntime
  -> ModelExecutionAdapterRegistry
  -> ModelExecutionAdapter
  -> provider/local-model executor
```

A model execution request carries the durable worker/task/tenant/repository/parent/coordinator/correlation identity, the exact assignment, allowed capabilities and authority, workspace boundary, budget, and duration. The response contract permits only status, conclusion, evidence, artifacts, tool results, handoff, failure reason, and usage. Private reasoning fields are rejected.

The generic `HttpModelExecutionAdapter` speaks `sentient-model-execution/v1` and deliberately makes no OpenAI-specific assumptions. A provider adapter may instead be in-process or local as long as it implements `ModelExecutionAdapter`.

## Durability and safety

`worker_runtime_executions` stores one execution per durable worker attempt, including request and assignment hashes, adapter/provider/model metadata, terminal result, failure reason, and spend. Assignment/hash mismatches fail closed. A process restart that finds a `running` execution with no known in-process continuation is marked failed with `runtime_restart_unknown_outcome`; the runtime does not replay a provider request whose external outcome may already have occurred.

The runtime re-reads the durable worker row before dispatch so repository, capability, authority, workspace, budget, parent, and correlation boundaries are not trusted from an in-memory caller. Terminal spend is reconciled into the existing worker cost accounting.

## Lead authority

The model runtime never acquires Lead authority. Lead workers remain on the existing supervised runtime. Specialist completion contributes a structured durable handoff, which `AutomaticLeadSupervisor` submits through the existing fenced Lead review path. Leadership epoch checks and final acceptance remain authoritative. For non-demo workers, `AutomaticLeadSupervisor` accepts completion only when a durable `worker_runtime_executions` record is completed and bound to the same worker, task, attempt, and assignment and contains a structured handoff. The deterministic fallback handoff is reserved for `supervised-demo`; missing or mismatched model execution evidence is never auto-accepted.

## Configuration

Automatic mode uses the existing demo runtime unless `MODEL_RUNTIME_ENDPOINT` is configured. When configured, specialist capabilities are routed to `ModelBackedWorkerRuntime` using:

- `MODEL_RUNTIME_ENDPOINT`
- `MODEL_RUNTIME_ADAPTER_ID` (optional)
- `MODEL_RUNTIME_PROVIDER_ID` (optional)
- `MODEL_RUNTIME_MODEL_ID` (optional)
- `MODEL_RUNTIME_AUTH_TOKEN` (optional)
- `MODEL_RUNTIME_CAPABILITIES`
- `MODEL_RUNTIME_MODEL_TIERS` (optional)

`lead-control` is kept off the model-backed specialist capability list.

## Remaining trust boundary

A remote `ModelExecutionAdapter` is an execution boundary. The runtime constrains the assignment and declared capabilities sent to it, rejects unauthorized reported tool capabilities and unexpected/private-reasoning result fields, and durably fences identity, result, and spend. It cannot by itself prevent a malicious remote adapter from performing undeclared external side effects; stronger enforcement requires a capability-broker or sandboxed provider adapter.

Restart recovery is intentionally fail-closed for an execution whose provider outcome is ambiguous. Resuming instead of retrying would require an adapter/provider contract for idempotent status lookup or reattachment.
