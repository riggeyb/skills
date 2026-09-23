export const SENTIENT_PROTOCOL_VERSION = "1.0" as const;
export const SUPPORTED_PROTOCOL_VERSIONS = [SENTIENT_PROTOCOL_VERSION] as const;

export type Authority =
  | "repository:read" | "repository:write" | "branch:create" | "commit" | "push"
  | "issue:comment" | "checks:read" | "checks:write" | "pr:create" | "secrets:access"
  | "sandbox:execute" | "workers:spawn" | "workers:cancel" | "merge";

export const AUTHORITIES: readonly Authority[] = [
  "repository:read", "repository:write", "branch:create", "commit", "push",
  "issue:comment", "checks:read", "checks:write", "pr:create", "secrets:access",
  "sandbox:execute", "workers:spawn", "workers:cancel", "merge",
] as const;

export interface RepositoryRef { owner: string; repo: string; }
export interface Budget { maxTokens?: number; maxCostUsd?: number; maxWallClockSeconds?: number; }
export interface ResourceClaim {
  resourceType: "file" | "directory" | "database-migration" | "api-interface" | "task" | "test-suite" | "artifact";
  resourceId: string;
  mode: "exclusive" | "shared";
  ownerWorkerId: string;
  taskId: string;
  tenantId: string;
  leaseId: string;
  acquiredAt: string;
  expiresAt: string;
  releasedAt?: string;
}
export interface WorkerContract {
  protocolVersion: typeof SENTIENT_PROTOCOL_VERSION;
  workerId: string;
  taskId: string;
  parentCoordinatorId?: string;
  tenantId: string;
  repository: RepositoryRef;
  role: string;
  objective: string;
  assignment: string;
  constraints: string[];
  dependencies: string[];
  capabilities: string[];
  authority: Authority[];
  resourceClaims: ResourceClaim[];
  branch?: string;
  workspace?: string;
  budget: Budget;
  deadline?: string;
  allowedTools: string[];
  modelRuntimeRequirements: { requiredCapabilities?: string[]; prohibitedProviders?: string[]; notes?: string[] };
  completionCriteria: string[];
  reportingRequirements: string[];
}

export const MESSAGE_KINDS = [
  "FINDING", "QUESTION", "ANSWER", "PROPOSAL", "DECISION", "DEPENDENCY", "BLOCKER",
  "CLAIM", "RELEASE", "HANDOFF", "VERIFICATION", "ESCALATION", "STATUS", "DONE",
] as const;
export type MessageKind = typeof MESSAGE_KINDS[number];

export interface Handoff {
  objective: string;
  completedWork: string[];
  filesCommitsArtifacts: string[];
  findings: string[];
  unresolvedQuestions: string[];
  dependencies: string[];
  testsResults: string[];
  risks: string[];
  recommendedNextAction: string;
}
export interface ProtocolMessage<T = Record<string, unknown>> {
  protocolVersion: typeof SENTIENT_PROTOCOL_VERSION;
  messageId: string;
  kind: MessageKind;
  taskId: string;
  tenantId: string;
  senderWorkerId: string;
  recipient: { type: "worker" | "coordinator" | "task" | "broadcast"; id?: string };
  timestamp: string;
  correlationId?: string;
  causalParentMessageId?: string;
  revisionSha?: string;
  payload: T;
}

export class ProtocolValidationError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
const fail = (code: string, message: string): never => { throw new ProtocolValidationError(code, message); };
const obj = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : fail("MALFORMED", "expected object");
const str = (v: unknown, field: string): string =>
  typeof v === "string" && v.length > 0 ? v : fail("MALFORMED", `${field} must be a non-empty string`);
const strings = (v: unknown, field: string): string[] =>
  Array.isArray(v) && v.every(x => typeof x === "string") ? v as string[] : fail("MALFORMED", `${field} must be a string array`);
const date = (v: unknown, field: string): string => {
  const s = str(v, field); if (Number.isNaN(Date.parse(s))) fail("MALFORMED", `${field} must be ISO date-time`); return s;
};
export function negotiateProtocolVersion(peerVersions: readonly string[]): typeof SENTIENT_PROTOCOL_VERSION {
  if (peerVersions.includes(SENTIENT_PROTOCOL_VERSION)) return SENTIENT_PROTOCOL_VERSION;
  return fail("UNSUPPORTED_VERSION", `supported=${SUPPORTED_PROTOCOL_VERSIONS.join(",")}`);
}
export function validateWorkerContract(input: unknown): WorkerContract {
  const v = obj(input);
  if (v.protocolVersion !== SENTIENT_PROTOCOL_VERSION) fail("UNSUPPORTED_VERSION", "unsupported worker contract version");
  for (const f of ["workerId","taskId","tenantId","role","objective","assignment"] as const) str(v[f], f);
  const repo = obj(v.repository); str(repo.owner, "repository.owner"); str(repo.repo, "repository.repo");
  const authority = strings(v.authority, "authority");
  for (const a of authority) if (!AUTHORITIES.includes(a as Authority)) fail("UNAUTHORIZED_CAPABILITY", `unknown authority ${a}`);
  strings(v.constraints, "constraints"); strings(v.dependencies, "dependencies"); strings(v.capabilities, "capabilities");
  strings(v.allowedTools, "allowedTools"); strings(v.completionCriteria, "completionCriteria"); strings(v.reportingRequirements, "reportingRequirements");
  if (!Array.isArray(v.resourceClaims)) fail("MALFORMED", "resourceClaims must be an array");
  for (const c of v.resourceClaims) validateResourceClaim(c);
  obj(v.budget); obj(v.modelRuntimeRequirements);
  if (v.deadline !== undefined) date(v.deadline, "deadline");
  return input as WorkerContract;
}
export function assertAuthority(contract: WorkerContract, requested: Authority): void {
  if (!contract.authority.includes(requested)) fail("AUTHORITY_VIOLATION", `${contract.workerId} lacks ${requested}`);
}
export function validateResourceClaim(input: unknown): ResourceClaim {
  const v = obj(input);
  for (const f of ["resourceType","resourceId","ownerWorkerId","taskId","tenantId","leaseId"] as const) str(v[f], f);
  if (!["exclusive","shared"].includes(String(v.mode))) fail("MALFORMED", "invalid claim mode");
  date(v.acquiredAt, "acquiredAt"); date(v.expiresAt, "expiresAt");
  if (v.releasedAt !== undefined) date(v.releasedAt, "releasedAt");
  return input as ResourceClaim;
}
export function claimIsActive(claim: ResourceClaim, now = new Date()): boolean {
  return !claim.releasedAt && Date.parse(claim.expiresAt) > now.getTime();
}
export function claimsConflict(a: ResourceClaim, b: ResourceClaim, now = new Date()): boolean {
  if (!claimIsActive(a, now) || !claimIsActive(b, now)) return false;
  if (a.tenantId !== b.tenantId || a.resourceType !== b.resourceType || a.resourceId !== b.resourceId) return false;
  return a.mode === "exclusive" || b.mode === "exclusive";
}
export function validateHandoff(input: unknown): Handoff {
  const v = obj(input); str(v.objective, "objective"); str(v.recommendedNextAction, "recommendedNextAction");
  for (const f of ["completedWork","filesCommitsArtifacts","findings","unresolvedQuestions","dependencies","testsResults","risks"] as const) strings(v[f], f);
  return input as Handoff;
}
export interface MessageValidationContext {
  contract: WorkerContract;
  knownMessages?: ReadonlyMap<string, ProtocolMessage>;
  requiredAuthority?: Authority;
}
export function validateMessage(input: unknown, context: MessageValidationContext): ProtocolMessage {
  const v = obj(input);
  if (v.protocolVersion !== SENTIENT_PROTOCOL_VERSION) fail("UNSUPPORTED_VERSION", "unsupported message version");
  for (const f of ["messageId","taskId","tenantId","senderWorkerId","timestamp","kind"] as const) str(v[f], f);
  if (!MESSAGE_KINDS.includes(v.kind as MessageKind)) fail("MALFORMED", "unknown message kind");
  date(v.timestamp, "timestamp"); obj(v.recipient); obj(v.payload);
  if (v.taskId !== context.contract.taskId) fail("CROSS_TASK", "message task differs from contract");
  if (v.tenantId !== context.contract.tenantId) fail("CROSS_TENANT", "message tenant differs from contract");
  if (v.senderWorkerId !== context.contract.workerId) fail("IDENTITY_MISMATCH", "sender differs from contract worker");
  if (context.requiredAuthority) assertAuthority(context.contract, context.requiredAuthority);
  if (v.causalParentMessageId !== undefined) {
    const id = str(v.causalParentMessageId, "causalParentMessageId");
    const parent = context.knownMessages?.get(id);
    if (!parent) fail("UNKNOWN_CAUSAL_PARENT", "causal parent not found");
    if (parent.taskId !== v.taskId || parent.tenantId !== v.tenantId) fail("INVALID_CAUSAL_PARENT", "causal parent crosses task/tenant");
  }
  if (v.kind === "HANDOFF") validateHandoff(v.payload);
  return input as ProtocolMessage;
}
