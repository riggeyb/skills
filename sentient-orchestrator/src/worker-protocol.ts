export const SENTIENT_PROTOCOL_VERSION = "1.0" as const;
export const SUPPORTED_PROTOCOL_VERSIONS = [SENTIENT_PROTOCOL_VERSION] as const;

export type Authority =
  | "repository:read" | "repository:write" | "branch:create" | "commit" | "push"
  | "issue:comment" | "checks:read" | "checks:write" | "pr:create" | "secrets:access"
  | "sandbox:execute" | "workers:spawn" | "workers:cancel" | "merge"
  | "leadership:acquire" | "workers:assign" | "workers:direct" | "coordination:resolve"
  | "handoffs:review" | "workers:rework" | "integration:ready";

export const AUTHORITIES: readonly Authority[] = [
  "repository:read","repository:write","branch:create","commit","push","issue:comment",
  "checks:read","checks:write","pr:create","secrets:access","sandbox:execute","workers:spawn",
  "workers:cancel","merge","leadership:acquire","workers:assign","workers:direct",
  "coordination:resolve","handoffs:review","workers:rework","integration:ready",
];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export interface BudgetEnvelope { maxTokens?: number; maxCostUsd?: number; maxDurationSeconds?: number }

export const RESOURCE_TYPES = [
  "file","directory","database-migration","api-interface","task","test-suite","artifact",
] as const;
export type ResourceType = typeof RESOURCE_TYPES[number];

export interface ResourceClaim {
  resourceType: ResourceType;
  resourceId: string;
  mode: "exclusive"|"shared";
  ownerWorkerId: string;
  taskId: string;
  tenantId: string;
  leaseId: string;
  acquiredAt: string;
  expiresAt: string;
  releasedAt?: string;
}

export interface WorkerContractV1 {
  protocolVersion: typeof SENTIENT_PROTOCOL_VERSION;
  workerId: string;
  taskId: string;
  parentWorkerId?: string;
  tenantId: string;
  repositoryId: string;
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
  budget: BudgetEnvelope;
  deadline?: string;
  allowedTools: string[];
  modelRuntimeRequirements: {
    requiredCapabilities?: string[];
    prohibitedProviders?: string[];
    notes?: string[];
  };
  completionCriteria: string[];
  reportingRequirements: string[];
}
export type WorkerContract = WorkerContractV1;

export const MESSAGE_TYPES = [
  "FINDING","QUESTION","ANSWER","PROPOSAL","DECISION","DEPENDENCY","BLOCKER","CLAIM","RELEASE",
  "HANDOFF","VERIFICATION","ESCALATION","STATUS","DONE",
  "ASSIGNMENT","ACKNOWLEDGEMENT","DIRECTIVE","REVIEW_DECISION","INTEGRATION_READY",
] as const;
export type MessageType = typeof MESSAGE_TYPES[number];

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

export interface AssignmentPayload {
  leadershipEpoch: number;
  assignmentId: string;
  idempotencyKey: string;
  targetWorkerId?: string;
  spawnRequestId?: string;
  objective: string;
  assignment: JsonValue;
  acceptanceCriteria: JsonValue;
  dependencies: string[];
  required: boolean;
}
export interface AcknowledgementPayload { assignmentId: string }
export interface DirectivePayload {
  leadershipEpoch: number;
  directiveId: string;
  idempotencyKey: string;
  assignmentId?: string;
  directiveType: string;
  payload: JsonValue;
}
export interface ReviewDecisionPayload {
  leadershipEpoch: number;
  assignmentId: string;
  handoffId: string;
  decision: "accepted" | "rework" | "rejected";
  reason?: string;
}
export interface IntegrationReadyPayload { leadershipEpoch: number }

export interface SentientEnvelope<T = unknown> {
  protocolVersion: typeof SENTIENT_PROTOCOL_VERSION;
  messageId: string;
  taskId: string;
  senderWorkerId: string;
  recipientWorkerId?: string;
  correlationId: string;
  causationId?: string;
  repositoryId: string;
  tenantId: string;
  revision?: string;
  type: MessageType;
  payload: T;
  createdAt: string;
}
export type ProtocolMessage<T = unknown> = SentientEnvelope<T>;

export const LEAD_AUTHORITY_BY_MESSAGE: Partial<Record<MessageType, Authority>> = {
  ASSIGNMENT: "workers:assign",
  DIRECTIVE: "workers:direct",
  REVIEW_DECISION: "handoffs:review",
  INTEGRATION_READY: "integration:ready",
};

export class ProtocolValidationError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
const fail = (code:string, message:string): never => { throw new ProtocolValidationError(code,message) };
const obj = (v:unknown): Record<string,unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? v as Record<string,unknown>
    : fail("MALFORMED","expected object");
const str = (v:unknown,f:string):string =>
  typeof v === "string" && v.length>0 ? v : fail("MALFORMED",`${f} must be a non-empty string`);
const strings=(v:unknown,f:string):string[] =>
  Array.isArray(v)&&v.every(x=>typeof x==="string") ? v as string[] : fail("MALFORMED",`${f} must be a string array`);
const date=(v:unknown,f:string):string=>{
  const s=str(v,f);
  if(Number.isNaN(Date.parse(s))) fail("MALFORMED",`${f} must be ISO date-time`);
  return s;
};
const positiveInt=(v:unknown,f:string):number=>{
  if(typeof v!=="number"||!Number.isInteger(v)||v<=0) fail("MALFORMED",`${f} must be a positive integer`);
  return v as number;
};
const bool=(v:unknown,f:string):boolean =>
  typeof v==="boolean" ? v : fail("MALFORMED",`${f} must be boolean`);

export function negotiateProtocolVersion(peerVersions: readonly string[]): typeof SENTIENT_PROTOCOL_VERSION {
  if(peerVersions.includes(SENTIENT_PROTOCOL_VERSION)) return SENTIENT_PROTOCOL_VERSION;
  return fail("UNSUPPORTED_VERSION",`supported=${SUPPORTED_PROTOCOL_VERSIONS.join(",")}`);
}

export function validateWorkerContract(input:unknown):WorkerContract {
  const v=obj(input);
  if(v.protocolVersion!==SENTIENT_PROTOCOL_VERSION) fail("UNSUPPORTED_VERSION","unsupported worker contract version");
  for(const f of ["workerId","taskId","tenantId","repositoryId","role","objective","assignment"] as const) str(v[f],f);
  const authority=strings(v.authority,"authority");
  for(const a of authority) {
    if(!AUTHORITIES.includes(a as Authority)) fail("UNAUTHORIZED_CAPABILITY",`unknown authority ${a}`);
  }
  for(const f of ["constraints","dependencies","capabilities","allowedTools","completionCriteria","reportingRequirements"] as const) strings(v[f],f);
  if(!Array.isArray(v.resourceClaims)) fail("MALFORMED","resourceClaims must be an array");
  for(const c of v.resourceClaims as unknown[]) {
    const claim=validateResourceClaim(c);
    if(claim.ownerWorkerId!==v.workerId) fail("IDENTITY_MISMATCH","resource claim owner differs from contract worker");
    if(claim.taskId!==v.taskId) fail("CROSS_TASK","resource claim task differs from contract");
    if(claim.tenantId!==v.tenantId) fail("CROSS_TENANT","resource claim tenant differs from contract");
  }
  const budget=obj(v.budget);
  for(const f of ["maxTokens","maxCostUsd","maxDurationSeconds"]) {
    if(budget[f]!==undefined && (typeof budget[f]!=="number" || (budget[f] as number)<0)) {
      fail("MALFORMED",`budget.${f} must be non-negative`);
    }
  }
  obj(v.modelRuntimeRequirements);
  if(v.deadline!==undefined) date(v.deadline,"deadline");
  return input as WorkerContract;
}

export function assertAuthority(contract:WorkerContract, requested:Authority):void {
  if(!contract.authority.includes(requested)) fail("AUTHORITY_VIOLATION",`${contract.workerId} lacks ${requested}`);
}

export function validateResourceClaim(input:unknown):ResourceClaim {
  const v=obj(input);
  const resourceType=str(v.resourceType,"resourceType");
  if(!RESOURCE_TYPES.includes(resourceType as ResourceType)) fail("MALFORMED","invalid resourceType");
  for(const f of ["resourceId","ownerWorkerId","taskId","tenantId","leaseId"] as const) str(v[f],f);
  if(!["exclusive","shared"].includes(String(v.mode))) fail("MALFORMED","invalid claim mode");
  date(v.acquiredAt,"acquiredAt");
  date(v.expiresAt,"expiresAt");
  if(v.releasedAt!==undefined) date(v.releasedAt,"releasedAt");
  return input as ResourceClaim;
}

export function claimIsActive(claim:ResourceClaim,now=new Date()):boolean {
  return !claim.releasedAt && Date.parse(claim.expiresAt)>now.getTime();
}
export function claimsConflict(a:ResourceClaim,b:ResourceClaim,now=new Date()):boolean {
  if(!claimIsActive(a,now)||!claimIsActive(b,now)) return false;
  if(a.tenantId!==b.tenantId||a.resourceType!==b.resourceType||a.resourceId!==b.resourceId) return false;
  return a.mode==="exclusive"||b.mode==="exclusive";
}

export function validateHandoff(input:unknown):Handoff {
  const v=obj(input);
  str(v.objective,"objective");
  str(v.recommendedNextAction,"recommendedNextAction");
  for(const f of ["completedWork","filesCommitsArtifacts","findings","unresolvedQuestions","dependencies","testsResults","risks"] as const) strings(v[f],f);
  return input as Handoff;
}

export interface MessageValidationContext {
  contract: WorkerContract;
  knownMessages?: ReadonlyMap<string,ProtocolMessage>;
  requiredAuthority?: Authority;
}

function validateLeadPayload(type: MessageType, payload: Record<string, unknown>): void {
  if(type==="ASSIGNMENT"){
    positiveInt(payload.leadershipEpoch,"leadershipEpoch");
    str(payload.assignmentId,"assignmentId");
    str(payload.idempotencyKey,"idempotencyKey");
    str(payload.objective,"objective");
    if(payload.targetWorkerId!==undefined) str(payload.targetWorkerId,"targetWorkerId");
    if(payload.spawnRequestId!==undefined) str(payload.spawnRequestId,"spawnRequestId");
    if(payload.assignment===undefined) fail("MALFORMED","assignment is required");
    if(payload.acceptanceCriteria===undefined) fail("MALFORMED","acceptanceCriteria is required");
    strings(payload.dependencies,"dependencies");
    bool(payload.required,"required");
  } else if(type==="ACKNOWLEDGEMENT"){
    str(payload.assignmentId,"assignmentId");
  } else if(type==="DIRECTIVE"){
    positiveInt(payload.leadershipEpoch,"leadershipEpoch");
    str(payload.directiveId,"directiveId");
    str(payload.idempotencyKey,"idempotencyKey");
    str(payload.directiveType,"directiveType");
    if(payload.assignmentId!==undefined) str(payload.assignmentId,"assignmentId");
    if(payload.payload===undefined) fail("MALFORMED","payload is required");
  } else if(type==="REVIEW_DECISION"){
    positiveInt(payload.leadershipEpoch,"leadershipEpoch");
    str(payload.assignmentId,"assignmentId");
    str(payload.handoffId,"handoffId");
    if(!["accepted","rework","rejected"].includes(String(payload.decision))) fail("MALFORMED","invalid review decision");
    if(payload.reason!==undefined) str(payload.reason,"reason");
  } else if(type==="INTEGRATION_READY"){
    positiveInt(payload.leadershipEpoch,"leadershipEpoch");
  }
}

export function validateMessage(input:unknown,context:MessageValidationContext):ProtocolMessage {
  const v=obj(input);
  if(v.protocolVersion!==SENTIENT_PROTOCOL_VERSION) fail("UNSUPPORTED_VERSION","unsupported message version");
  for(const f of ["messageId","taskId","senderWorkerId","correlationId","repositoryId","tenantId","type"] as const) str(v[f],f);
  if(!MESSAGE_TYPES.includes(v.type as MessageType)) fail("MALFORMED","unknown message type");
  date(v.createdAt,"createdAt");
  const payload=obj(v.payload);
  if(v.taskId!==context.contract.taskId) fail("CROSS_TASK","message task differs from contract");
  if(v.tenantId!==context.contract.tenantId) fail("CROSS_TENANT","message tenant differs from contract");
  if(v.repositoryId!==context.contract.repositoryId) fail("CROSS_REPOSITORY","message repository differs from contract");
  if(v.senderWorkerId!==context.contract.workerId) fail("IDENTITY_MISMATCH","sender differs from contract worker");
  if(context.requiredAuthority) assertAuthority(context.contract,context.requiredAuthority);
  if(v.causationId!==undefined){
    const id=str(v.causationId,"causationId");
    const parent=context.knownMessages?.get(id);
    if(!parent) return fail("UNKNOWN_CAUSAL_PARENT","causal parent not found");
    if(parent.taskId!==v.taskId||parent.tenantId!==v.tenantId||parent.repositoryId!==v.repositoryId) {
      fail("INVALID_CAUSAL_PARENT","causal parent crosses identity boundary");
    }
  }
  if(v.type==="HANDOFF") validateHandoff(v.payload);
  validateLeadPayload(v.type as MessageType, payload);
  return input as ProtocolMessage;
}
