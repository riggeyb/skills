import assert from "node:assert/strict";
import test from "node:test";
import {
  assertAuthority, claimsConflict, negotiateProtocolVersion, ProtocolValidationError,
  validateHandoff, validateMessage, validateWorkerContract, type ProtocolMessage, type ResourceClaim,
} from "../src/worker-protocol.js";

const base = () => ({
  protocolVersion:"1.0", workerId:"w1", taskId:"t1", parentWorkerId:"w0", tenantId:"tenant-a", repositoryId:"riggeyb/skills",
  role:"implementer", objective:"ship protocol", assignment:"protocol only", constraints:[], dependencies:[], capabilities:["typescript"],
  authority:["repository:read","repository:write"], resourceClaims:[], branch:"sentient/worker-protocol",
  budget:{maxTokens:1000,maxCostUsd:10,maxDurationSeconds:600}, allowedTools:["github"],
  modelRuntimeRequirements:{requiredCapabilities:["tools"]}, completionCriteria:["tests pass"], reportingRequirements:["DONE"],
});
const message=(overrides:Record<string,unknown>={})=>({
  protocolVersion:"1.0",messageId:"m1",type:"STATUS",taskId:"t1",senderWorkerId:"w1",correlationId:"corr-1",
  repositoryId:"riggeyb/skills",tenantId:"tenant-a",createdAt:"2026-09-23T18:00:00Z",payload:{summary:"working"},...overrides,
});
const throwsCode=(fn:()=>unknown,code:string)=>assert.throws(fn,(e:unknown)=>e instanceof ProtocolValidationError&&e.code===code);

test("valid/invalid worker contracts",()=>{ assert.equal(validateWorkerContract(base()).workerId,"w1"); throwsCode(()=>validateWorkerContract({...base(),workerId:""}),"MALFORMED") });
test("unknown versions and v1 negotiation",()=>{ assert.equal(negotiateProtocolVersion(["0.9","1.0"]),"1.0"); throwsCode(()=>negotiateProtocolVersion(["2.0"]),"UNSUPPORTED_VERSION"); throwsCode(()=>validateWorkerContract({...base(),protocolVersion:"2.0"}),"UNSUPPORTED_VERSION") });
test("authority violations and unauthorized capabilities",()=>{ const c=validateWorkerContract(base()); assertAuthority(c,"repository:write"); throwsCode(()=>assertAuthority(c,"merge"),"AUTHORITY_VIOLATION"); throwsCode(()=>validateWorkerContract({...base(),authority:["god-mode"]}),"UNAUTHORIZED_CAPABILITY") });
test("malformed/cross-task/cross-tenant messages",()=>{ const c=validateWorkerContract(base()); throwsCode(()=>validateMessage({...message(),payload:"bad"},{contract:c}),"MALFORMED"); throwsCode(()=>validateMessage(message({taskId:"t2"}),{contract:c}),"CROSS_TASK"); throwsCode(()=>validateMessage(message({tenantId:"tenant-b"}),{contract:c}),"CROSS_TENANT") });
test("valid handoff",()=>{ const payload={objective:"continue",completedWork:["types"],filesCommitsArtifacts:["abc"],findings:[],unresolvedQuestions:[],dependencies:[],testsResults:["pass"],risks:[],recommendedNextAction:"integrate"}; assert.equal(validateHandoff(payload).objective,"continue"); const c=validateWorkerContract(base()); assert.equal(validateMessage(message({type:"HANDOFF",payload}),{contract:c}).type,"HANDOFF") });
test("resource claim conflicts and expiration",()=>{ const mk=(mode:"shared"|"exclusive",expiresAt="2026-09-24T00:00:00Z"):ResourceClaim=>({resourceType:"file",resourceId:"a.ts",mode,ownerWorkerId:"w1",taskId:"t1",tenantId:"tenant-a",leaseId:mode,acquiredAt:"2026-09-23T17:00:00Z",expiresAt}); const now=new Date("2026-09-23T18:00:00Z"); assert.equal(claimsConflict(mk("shared"),mk("shared"),now),false); assert.equal(claimsConflict(mk("exclusive"),mk("shared"),now),true); assert.equal(claimsConflict(mk("exclusive","2026-09-23T17:30:00Z"),mk("shared"),now),false) });
test("causal relationships",()=>{ const c=validateWorkerContract(base()); const parent=message() as ProtocolMessage; const known=new Map([[parent.messageId,parent]]); assert.equal(validateMessage(message({messageId:"m2",causationId:"m1"}),{contract:c,knownMessages:known}).causationId,"m1"); throwsCode(()=>validateMessage(message({messageId:"m2",causationId:"missing"}),{contract:c,knownMessages:known}),"UNKNOWN_CAUSAL_PARENT"); const cross={...parent,tenantId:"other"}; throwsCode(()=>validateMessage(message({messageId:"m2",causationId:"x"}),{contract:c,knownMessages:new Map([["x",cross]])}),"INVALID_CAUSAL_PARENT") });
