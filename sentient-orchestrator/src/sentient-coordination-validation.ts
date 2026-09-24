import type { JsonValue } from "./worker-protocol.js";
import {
  COORDINATION_MESSAGE_TYPES,
  type CoordinationDraft,
  type SentientCoordinationMessage,
} from "./sentient-coordination-types.js";
import { SENTIENT_PROTOCOL_VERSION } from "./worker-protocol.js";

export class CoordinationError extends Error {
  constructor(public readonly code:string,message:string){super(message)}
}

export interface DurableCoordinationWorker {
  id:string; task_id:string; tenant:string; repository_owner:string; repository_name:string;
  role:string; status:string; correlation_id:string; attempt_count:number|string;
}

const PRIVATE_KEYS=new Set([
  "reasoning","analysis","scratchpad","internalreasoning","internal_reasoning",
  "chainofthought","chain_of_thought","thoughts",
]);

export function assertCoordinationType(type:string):void{
  if(!COORDINATION_MESSAGE_TYPES.includes(type as any))
    throw new CoordinationError("UNSUPPORTED_MESSAGE_TYPE",type);
}
export function assertJsonPayload(value:unknown):asserts value is JsonValue{
  const ok=(v:unknown):boolean=>{
    if(v===null||typeof v==="string"||typeof v==="boolean")return true;
    if(typeof v==="number")return Number.isFinite(v);
    if(Array.isArray(v))return v.every(ok);
    if(v&&typeof v==="object")return Object.entries(v as Record<string,unknown>).every(([k,x])=>k.length>0&&ok(x));
    return false;
  };
  if(!ok(value))throw new CoordinationError("MALFORMED_PAYLOAD","payload must be JSON");
}
export function rejectPrivateReasoning(value:unknown):void{
  if(Array.isArray(value)){for(const x of value)rejectPrivateReasoning(x);return}
  if(!value||typeof value!=="object")return;
  for(const [k,x] of Object.entries(value as Record<string,unknown>)){
    const n=k.replace(/[-\s]/g,"").toLowerCase();
    if(PRIVATE_KEYS.has(n)||PRIVATE_KEYS.has(k.toLowerCase()))
      throw new CoordinationError("PRIVATE_REASONING_FORBIDDEN",`forbidden message field: ${k}`);
    rejectPrivateReasoning(x);
  }
}
export function assertBoundary(row:any,w:DurableCoordinationWorker):void{
  if(row.task_id!==w.task_id)throw new CoordinationError("CROSS_TASK","task boundary violation");
  if(row.tenant!==w.tenant)throw new CoordinationError("CROSS_TENANT","tenant boundary violation");
  if(row.repository_owner!==w.repository_owner||row.repository_name!==w.repository_name)
    throw new CoordinationError("CROSS_REPOSITORY","repository boundary violation");
}
export function assertUuid(v:string,field:string):void{
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v))
    throw new CoordinationError("MALFORMED",`${field} must be UUID`);
}
export function nonEmpty(v:string,field:string):string{
  if(typeof v!=="string"||v.length===0)throw new CoordinationError("MALFORMED",`${field} must be non-empty`);
  return v;
}
export function stableJson(v:unknown):string{
  if(Array.isArray(v))return `[${v.map(stableJson).join(",")}]`;
  if(v&&typeof v==="object")return `{${Object.entries(v as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>`${JSON.stringify(k)}:${stableJson(x)}`).join(",")}}`;
  return JSON.stringify(v)??"null";
}
const iso=(v:unknown)=>v instanceof Date?v.toISOString():new Date(String(v)).toISOString();
export function mapCoordinationMessage(row:any):SentientCoordinationMessage{
  return {
    protocolVersion:SENTIENT_PROTOCOL_VERSION,messageId:row.message_id,taskId:row.task_id,
    senderWorkerId:row.sender_worker_id,recipientWorkerId:row.recipient_worker_id??undefined,
    correlationId:row.correlation_id,causationId:row.causation_id??undefined,
    repositoryId:`${row.repository_owner}/${row.repository_name}`,tenantId:row.tenant,
    type:row.message_type,payload:row.payload,createdAt:iso(row.created_at),targetKind:row.target_kind,
    leadershipEpoch:row.sender_leadership_epoch==null?undefined:Number(row.sender_leadership_epoch),
  };
}
export function assertIdempotentMessage(row:any,w:DurableCoordinationWorker,d:CoordinationDraft,correlationId:string):void{
  const recipient=d.target.kind==="worker"?d.target.workerId:null;
  const same=row.protocol_version===SENTIENT_PROTOCOL_VERSION&&row.task_id===w.task_id&&row.tenant===w.tenant&&
    row.repository_owner===w.repository_owner&&row.repository_name===w.repository_name&&row.sender_worker_id===w.id&&
    row.target_kind===d.target.kind&&(row.recipient_worker_id??null)===recipient&&row.message_type===d.type&&
    row.correlation_id===correlationId&&(row.causation_id??null)===(d.causationId??null)&&
    (row.sender_leadership_epoch==null?d.leadershipEpoch==null:Number(row.sender_leadership_epoch)===d.leadershipEpoch)&&
    stableJson(row.payload)===stableJson(d.payload);
  if(!same)throw new CoordinationError("MESSAGE_ID_CONFLICT","message id already bound to diffferent content");
}
