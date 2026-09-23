export const SENTIENT_PROTOCOL_VERSION = "1.0" as const;
export const SUPPORTED_PROTOCOL_VERSIONS = [SENTIENT_PROTOCOL_VERSION] as const;

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface RepositoryBinding { owner: string; repo: string }

export type Authority =
  | "repository:read" | "repository:write" | "branch:create" | "commit" | "push"
  | "issue:comment" | "checks:read" | "checks:write" | "pr:create" | "secrets:access"
  | "sandbox:execute" | "workers:spawn" | "workers:cancel" | "merge"
  | "lead:assign" | "lead:directive" | "lead:coordinate" | "lead:review"
  | "lead:rework" | "lead:integration-ready";
export const AUTHORITIES: readonly Authority[] = [
  "repository:read","repository:write","branch:create","commit","push","issue:comment",
  "checks:read","checks:write","pr:create","secrets:access","sandbox:execute","workers:spawn",
  "workers:cancel","merge","lead:assign","lead:directive","lead:coordinate","lead:review",
  "lead:rework","lead:integration-ready",
];
export const LEAD_AUTHORITIES: readonly Authority[] = [
  "lead:assign","lead:directive","lead:coordinate","lead:review","lead:rework","lead:integration-ready",
];
export const RESOURCE_TYPES = ["file","directory","database-migration","api-interface","task","test-suite","artifact"] as const;
export type ResourceType = typeof RESOURCE_TYPES[number];

export interface BudgetEnvelope { maxTokens?: number; maxCostUsd?: number; maxWallClockSeconds?: number }
export interface ResourceClaim {
  resourceType: ResourceType; resourceId: string; mode: "exclusive"|"shared"; ownerWorkerId: string;
  taskId: string; tenantId: string; leaseId: string; acquiredAt: string; expiresAt: string; releasedAt?: string;
}
export interface WorkerContractV1 {
  protocolVersion: typeof SENTIENT_PROTOCOL_VERSION; workerId: string; taskId: string; parentWorkerId?: string;
  tenantId: string; correlationId: string; repository: RepositoryBinding; role: string; objective: string; assignment: JsonValue;
  constraints: string[]; dependencies: string[]; capabilities: string[]; authority: Authority[];
  resourceClaims: ResourceClaim[]; branch?: string; workspace?: string; budget: BudgetEnvelope; deadline?: string;
  allowedTools: string[]; modelRuntimeRequirements: { requiredCapabilities?: string[]; prohibitedProviders?: string[]; notes?: string[] };
  completionCriteria: string[]; reportingRequirements: string[];
}
export type WorkerContract = WorkerContractV1;

export const MESSAGE_TYPES = [
  "FINDING","QUESTION","ANSWER","PROPOSAL","DECISION","ASSIGNMENT","ACKNOWLEDGEMENT","DIRECTIVE",
  "DEPENDENCY","BLOCKER","CLAIM","RELEASE","HANDOFF","REVIEW_DECISION","INTEGRATION_READY",
  "VERIFICATION","ESCALATION","STATUS","DONE",
] as const;
export type MessageType = typeof MESSAGE_TYPES[number];

export interface Handoff {
  objective: string; completedWork: string[]; filesCommitsArtifacts: string[]; findings: string[];
  unresolvedQuestions: string[]; dependencies: string[]; testsResults: string[]; risks: string[]; recommendedNextAction: string;
}
export interface AssignmentPayload { assignmentId: string; leadershipEpoch: number; targetWorkerId: string; objective: string; assignment: JsonValue; acceptanceCriteria: JsonValue }
export interface AcknowledgementPayload { assignmentId: string; status: "acknowledged"|"blocked"; note?: string }
export interface DirectivePayload { assignmentId: string; leadershipEpoch: number; directive: JsonValue }
export interface DependencyPayload { assignmentId?: string; dependencyIds: string[]; note?: string }
export interface BlockerPayload { assignmentId?: string; blocker: string; dependencyIds?: string[] }
export interface HandoffPayload { assignmentId: string; handoffId: string; handoff: Handoff }
export interface ReviewDecisionPayload { assignmentId: string; handoffId: string; leadershipEpoch: number; decision: "accepted"|"rework"|"rejected"; rationale?: string }
export interface IntegrationReadyPayload { leadershipEpoch: number; assignmentIds: string[] }
export interface EscalationPayload { assignmentId?: string; reason: string; requestedAction?: string }

export interface SentientEnvelope<T = JsonValue> {
  protocolVersion: typeof SENTIENT_PROTOCOL_VERSION; messageId: string; taskId: string; senderWorkerId: string;
  recipientWorkerId?: string; correlationId: string; causationId?: string; repository: RepositoryBinding; tenantId: string;
  revision?: string; type: MessageType; payload: T; createdAt: string;
}
export type ProtocolMessage<T = JsonValue> = SentientEnvelope<T>;

export class ProtocolValidationError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
const fail=(code:string,message:string):never=>{throw new ProtocolValidationError(code,message)};
const obj=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:fail("MALFORMED","expected object");
const str=(v:unknown,f:string):string=>typeof v==="string"&&v.length>0?v:fail("MALFORMED", `${f} must be a non-empty string`);
const strings=(v:unknown,f:string):string[]=>Array.isArray(v)&&v.every(x=>typeof x==="string")?v as string[]:fail("MALFORMED",`${f} must be a string array`);
const date=(v:unknown,f:string):string=>{const s=str(v,f);if(Number.isNaN(Date.parse(s)))fail("MALFORMED",`${f} must be ISO date-time`);return s};
const epoch=(v:unknown):number=>Number.isInteger(v)&&(v as number)>0?v as number:fail("MALFORMED","leadershipEpoch must be a positive integer");
const repository=(v:unknown):RepositoryBinding=>{const r=obj(v);return {owner:str(r.owner,"repository.owner"),repo:str(r.repo,"repository.repo")}};

export function validateJsonValue(input: unknown, ancestors = new WeakSet<object>()): JsonValue {
  if(input===null||typeof input==="string"||typeof input==="boolean") return input;
  if(typeof input==="number") return Number.isFinite(input)?input:fail("MALFORMED","JSON number must be finite");
  if(typeof input!=="object") return fail("MALFORMED","value must be JSON-compatible");
  const o=input as object;
  if(ancestors.has(o)) return fail("MALFORMED","cyclic JSON value");
  ancestors.add(o);
  try {
    if(Array.isArray(input)) return input.map(x=>validateJsonValue(x,ancestors));
    const proto=Object.getPrototypeOf(input);
    if(proto!==Object.prototype&&proto!==null) return fail("MALFORMED","JSON object must be a plain object");
    const out:Record<string,JsonValue>={};
    for(const [k,v] of Object.entries(input as Record<string,unknown>)) out[k]=validateJsonValue(v,ancestors);
    for(const s of Object.getOwnPropertySymbols(input)) if(Object.prototype.propertyIsEnumerable.call(input,s)) fail("MALFORMED","symbol keys are not JSON-compatible");
    return out;
  } finally { ancestors.delete(o); }
}

export function negotiateProtocolVersion(peerVersions: readonly string[]): typeof SENTIENT_PROTOCOL_VERSION {
  if(peerVersions.includes(SENTIENT_PROTOCOL_VERSION)) return SENTIENT_PROTOCOL_VERSION;
  return fail("UNSUPPORTED_VERSION",`supported=${SUPPORTED_PROTOCOL_VERSIONS.join(",")}`);
}
export function validateResourceClaim(input:unknown, contract?:Pick<WorkerContract,"workerId"|"taskId"|"tenantId">):ResourceClaim {
  const v=obj(input);
  const rt=str(v.resourceType,"resourceType");
  if(!RESOURCE_TYPES.includes(rt as ResourceType)) fail("MALFORMED","invalid resource type");
  for(const f of ["resourceId","ownerWorkerId","taskId","tenantId","leaseId"] as const) str(v[f],f);
  if(!["exclusive","shared"].includes(String(v.mode))) fail("MALFORMED","invalid claim mode");
  date(v.acquiredAt,"acquiredAt"); date(v.expiresAt,"expiresAt"); if(v.releasedAt!==undefined) date(v.releasedAt,"releasedAt");
  if(contract && (v.ownerWorkerId!==contract.workerId||v.taskId!==contract.taskId||v.tenantId!==contract.tenantId)) fail("IDENTITY_MISMATCH","resource claim differs from contract identity");
  return input as ResourceClaim;
}
export function validateWorkerContract(input:unknown):WorkerContract {
  const v=obj(input); if(v.protocolVersion!==SENTIENT_PROTOCOL_VERSION) fail("UNSUPPORTED_VERSION","unsupported worker contract version");
  for(const f of ["workerId","taskId","tenantId","correlationId","role","objective"] as const) str(v[f],f);
  repository(v>repository); validateJsonValue(v.assignment);
  const authority=strings(v.authority,"authority"); for(const a of authority) if(!AUTHORITIES.includes(a as Authority)) fail("UNAUTHORIZED_CAPABILITY",`unknown authority ${a}`);
  for(const f of ["constraints","dependencies","capabilities","allowedTools","completionCriteria","reportingRequirements"] as const) strings(v[f],f);
  if(!Array.isArray(v.resourceClaims)) fail("MALFORMED","resourceClaims must be an array");
  const identity={workerId:v.workerId as string,taskId:v.taskId as string,tenantId:v.tenantId as string};
  for(const c of v.resourceClaims as unknown[]) validateResourceClaim(c,identity);
  const budget=obj(v.budget); for(const f of ["maxTokens","maxCostUsd","maxWallClockSeconds"]) if(budget[f]!==undefined&&(typeof budget[f]!=="number"||!Number.isFinite(budget[f])||(budget[f] as number)<0)) fail("MALFORMED",`budget.${f} must be non-negative`);
  obj(v.modelRuntimeRequirements); if(v.deadline!==undefined) date(v.deadline,"deadline");
  return input as WorkerContract;
}
export function assertAuthority(contract:WorkerContract,requested:Authority):void {
  if(!contract.authority.includes(requested)) fail("AUTHORITY_VIOLATION",`${contract.workerId} lacks ${requested}`);
}
export function claimIsActive(claim:ResourceClaim,now=new Date()):boolean{return !claim.releasedAt&&Date.parse(claim.expiresAt)>now.getTime()}
export function claimsConflict(a:ResourceClaim,b:ResourceClaim,now=new Date()):boolean {
  if(!claimIsActive(a,now)||!claimIsActive(b,now))return false;
  if(a.tenantId!==b.tenantId||a.resourceType!==b.resourceType||a.resourceId!==b.resourceId)return false;
  return a.mode==="exclusive"||b.mode==="exclusive";
}
export function validateHandoff(input:unknown):Handoff {
  const v=obj(input); str(v.objective,"objective"); str(v.recommendedNextAction,"recommendedNextAction");
  for(const f of ["completedWork","filesCommitsArtifacts","findings","unresolvedQuestions","dependencies","testsResults","risks"] as const) strings(v[f],f);
  return input as Handoff;
}
function validatePayload(type:MessageType,input:unknown):void {
  const v=obj(input);
  if(type==="ASSIGNMENT"){str(v.assignmentId,"assignmentId");epoch(v>leadershipEpoch);str(v.targetWorkerId,"targetWorkerId");str(v.objective,"objective");validateJsonValue(v.assignment);validateJsonValue(v.acceptanceCriteria)}
  else if(type==="ACKNOWLEDGEMENT"){str(v.assignmentId,"assignmentId");if(!["acknowledged","blocked"].includes(String(v.status)))fail("MALFORMED","invalid acknowledgement status")}
  else if(type==="DIRECTIVE"){str(v.assignmentId,"assignmentId");epoch(v.leadershipEpoch);validateJsonValue(v.directive)}
  else if(type==="DEPENDENCY"){strings(v.dependencyIds,"dependencyIds")}
  else if(type==="BLOCKER"){str(v.blocker,"blocker")}
  else if(type==="HANDOFF"){str(v.assignmentId,"assignmentId");str(v.handoffId,"handoffId");validateHandoff(v.handoff)}
  else if(type==="REVIEW_DECISION"){str(v.assignmentId,"assignmentId");str(v.handoffId,"handoffId");epoch(v>leadershipEpoch);if(!["accepted","rework","rejected"].includes(String(v.decision)))fail("MALFORMED","invalid review decision")}
  else if(type==="INTEGRATION_READY"){epoch(v>leadershipEpoch);strings(v>assignmentIds,"assignmentIds")}
  else if(type==="ESCALATION"){str(v.reason,"reason")}
  else validateJsonValue(input);
}
export interface MessageValidationContext { contract:WorkerContract; knownMessages?:ReadonlyMap<string,ProtocolMessage>; requiredAuthority?:Authority }
export function validateMessage(input:unknown,context:MessageValidationContext):ProtocolMessage {
  const v=obj(input); const c=context.contract;
  if(v.protocolVersion!==SENTIENT_PROTOCOL_VERSION)fail("UNSUPPORTED_VERSION","unsupported message version");
  for(const f of ["messageId","taskId","senderWorkerId","correlationId","tenantId","type"] as const)str(v[f],f);
  if(!MESSAGE_TYPES.includes(v.type as MessageType))fail("MALFORMED","unknown message type");
  date(v.createdAt,"createdAt"); const repo=repository(v.repository); validatePayload(v.type as MessageType,v.payload);
  if(v.taskId!==c.taskId)fail("CROSS_TASK","message task differs from contract");
  if(v.tenantId!==c.tenantId)fail("CROSS_TENANT","message tenant differs from contract");
  if(repo.owner!==c.repository.owner||repo.repo!==c.repository.repo)fail("CROSS_REPOSITORY","message repository differs from contract");
  if(v.senderWorkerId!==c.workerId)fail("IDENTITY_MISMATCH","sender differs from contract worker");
  if(v.correlationId!==c.correlationId)fail("IDENTITY_MISMATCH","correlation differs from contract");
  if(context.requiredAuthority)assertAuthority(c,context.requiredAuthority);
  if(v.causationId!==undefined){
    const id=str(v.causationId,"causationId"),parent=context.knownMessages?.get(id);
    if(!parent)return fail("UNKNOWN_CAUSAL_PARENT","causal parent not found");
    if(parent.taskId!==v.taskId||parent.tenantId!==v.tenantId||parent.repository.owner!==repo.owner||parent.repository.repo!==repo.repo)fail("INVALID_CAUSAL_PARENT","causal parent crosses identity boundary");
  }
  return input as ProtocolMessage;
}
