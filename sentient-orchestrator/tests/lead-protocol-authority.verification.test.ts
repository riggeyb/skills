import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTHORITIES,
  LEAD_AUTHORITY_BY_MESSAGE,
  ProtocolValidationError,
  validateMessage,
  validateWorkerContract,
} from "../src/worker-protocol.js";

const contract = validateWorkerContract({
  protocolVersion: "1.0",
  workerId: "lead-1",
  taskId: "task-1",
  tenantId: "tenant-a",
  repositoryId: "riggeyb/skills",
  role: "lead",
  objective: "coordinate",
  assignment: "bounded",
  constraints: [],
  dependencies: [],
  capabilities: [],
  authority: [...AUTHORITIES],
  resourceClaims: [],
  budget: {},
  allowedTools: [],
  modelRuntimeRequirements: {},
  completionCriteria: [],
  reportingRequirements: [],
});

const payloads: Record<string, Record<string, unknown>> = {
  ASSIGNMENT: {
    leadershipEpoch: 1,
    assignmentId: "assignment-1",
    idempotencyKey: "assignment-key",
    targetWorkerId: "worker-1",
    objective: "bounded work",
    assignment: {},
    acceptanceCriteria: [],
    dependencies: [],
    required: true,
  },
  DIRECTIVE: {
    leadershipEpoch: 1,
    directiveId: "directive-1",
    idempotencyKey: "directive-key",
    assignmentId: "assignment-1",
    directiveType: "redirect",
    payload: {},
  },
  REVIEW_DECISION: {
    leadershipEpoch: 1,
    assignmentId: "assignment-1",
    handoffId: "handoff-1",
    decision: "accepted",
  },
  INTEGRATION_READY: {
    leadershipEpoch: 1,
  },
};

function envelope(type: string, payload: Record<string, unknown>) {
  return {
    protocolVersion: "1.0",
    messageId: `message-${type}`,
    type,
    taskId: "task-1",
    senderWorkerId: "lead-1",
    correlationId: "correlation-1",
    repositoryId: "riggeyb/skills",
    tenantId: "tenant-a",
    createdAt: "2026-09-23T19:00:00Z",
    payload,
  };
}

const malformed = (error: unknown) =>
  error instanceof ProtocolValidationError && error.code === "MALFORMED";

test("every authoritative Lead command requires a positive leadershipEpoch", () => {
  assert.deepEqual(
    new Set(Object.keys(LEAD_AUTHORITY_BY_MESSAGE)),
    new Set(["ASSIGNMENT", "DIRECTIVE", "REVIEW_DECISION", "INTEGRATION_READY"]),
  );

  for (const [type, payload] of Object.entries(payloads)) {
    assert.ok(LEAD_AUTHORITY_BY_MESSAGE[type as keyof typeof LEAD_AUTHORITY_BY_MESSAGE]);
    assert.equal(validateMessage(envelope(type, payload), { contract }).type, type);

    assert.throws(
      () => validateMessage(envelope(type, { ...payload, leadershipEpoch: 0 }), { contract }),
      malformed,
      `${type} must reject epoch zero`,
    );

    const missing = { ...payload };
    delete missing.leadershipEpoch;
    assert.throws(
      () => validateMessage(envelope(type, missing), { contract }),
      malformed,
      `${type} must reject a missing epoch`,
    );
  }
});

test("review decisions require assignment and handoff identifiers", () => {
  const payload = payloads.REVIEW_DECISION;
  for (const field of ["assignmentId", "handoffId"] as const) {
    const invalid = { ...payload };
    delete invalid[field];
    assert.throws(
      () => validateMessage(envelope("REVIEW_DECISION", invalid), { contract }),
      malformed,
    );
  }
});
