import assert from"node:assert/strict";import test from"node:test";import{randomUUID}from"node:crypto";import{readFileSync}from"node:fs";import{Pool}from"pg";
import{LeadOrchestrationError,LeadOrchestrationStore}from"../src/lead-orchestration.js";
import{AUTHORITIES,LEAD_AUTHORITY_BY_MESSAGE,ProtocolValidationError,assertAuthority,validateMessage,validateWorkerContract}from"../src/worker-protocol.js";
const url=process.env.DATABASE_URL;
async function task(db:Pool,n:string){const d=randomUUID();return(await db.query(`INSERT INTO tasks(delivery_id,objective,status,origin)VALUES($1,$2,'running','{}'::jsonb)RETURNING id`,[d,n])).rows[0].id as string}
async function spawn(db:Pool,t:string){return(await db.query(`INSERT INTO worker_spawn_requests(task_id,tenant,repository_owner,repository_name,role,subtask,idempotency_key,correlation_id)VALUES($1,'tenant-a','riggeyb','skills','specialist','{}'::jsonb,$2,$3)RETURNING id`,[t,randomUUID(),randomUUID()])).rows[0].id as string}
async function worker(db:Pool,t:string,role:"lead"|"specialist"){const s=await spawn(db,t);return(await db.query(`INSERT INTO sentient_workers(spawn_request_id,task_id,tenant,repository_owner,repository_name,role,assignment,status,correlation_id)VALUES($1,$2,'tenant-a','riggeyb','skills',$3,'{}'::jsonb,'running',$4)RETURNING id`,[s,t,role,randomUUID()])).rows[0].id as string}
const leadErr=(code:string)=>(e:unknown)=>e instanceof LeadOrchestrationError&&e.code===code;

test("race/takeover increments epoch and fences stale assign/direct/review/readiness",{skip:!url},async()=>{const db=new Pool({connectionString:url!});try{
 const t=await task(db,"race"),a=await worker(db,t,"lead"),b=await worker(db,t,"lead"),w=await worker(db,t,"specialist"),s=new LeadOrchestrationStore(db);
 const r=await Promise.allSettled([s.acquireLeadership(t,a,60000),s.acquireLeadership(t,b,60000)]);assert.equal(r.filter(x=>x.status==="fulfilled").length,1);
 const win=r.find(x=>x.status==="fulfilled");assert.ok(win&&win.status==="fulfilled");const old=win.value.leadWorkerId,neu=old===a?b:a,e=win.value.epoch;
 await db.query(`UPDATE task_leadership SET lease_expires_at=now()-interval'1 second' WHERE task_id=$1`,[t]);const n=await s.acquireLeadership(t,neu,60000);assert.equal(n.epoch,e+1);
 await assert.rejects(s.assign({taskId:t,leadWorkerId:old,epoch:e,externalId:"stale",idempotencyKey:randomUUID(),targetWorkerId:w,objective:"x",assignment:{},acceptanceCriteria:[],dependencies:[],required:true}),leadErr("STALE_LEAD"));
 await assert.rejects(s.directive({taskId:t,leadWorkerId:old,epoch:e,externalId:"d",idempotencyKey:randomUUID(),directiveType:"redirect",payload:{}}),leadErr("STALE_LEAD"));
 await s.assign({taskId:t,leadWorkerId:neu,epoch:n.epoch,externalId:"a1",idempotencyKey:randomUUID(),targetWorkerId:w,objective:"x",assignment:{},acceptanceCriteria:[],dependencies:[],required:true});await s.submitHandoff(t,"a1",w,{v:1});
 await assert.rejects(s.review({taskId:t,leadWorkerId:old,epoch:e,assignmentId:"a1",handoffId:"h1",decision:"accepted"}),leadErr("STALE_LEAD"));await assert.rejects(s.markIntegrationReady(t,old,e),leadErr("STALE_LEAD"));
}finally{await db.end()}});

test("pending/blocked/handoff/rework gate readiness and rework history survives",{skip:!url},async()=>{const db=new Pool({connectionString:url!});try{
 const t=await task(db,"gate"),l=await worker(db,t,"lead"),w=await worker(db,t,"specialist"),s=new LeadOrchestrationStore(db),lead=await s.acquireLeadership(t,l,60000);
 await s.assign({taskId:t,leadWorkerId:l,epoch:lead.epoch,externalId:"req",idempotencyKey:randomUUID(),targetWorkerId:w,objective:"x",assignment:{},acceptanceCriteria:[],dependencies:[],required:true});assert.equal((await s.integrationStatus(t)).ready,false);
 await db.query(`UPDATE worker_assignments SET status='blocked' WHERE task_id=$1`,[t]);assert.deepEqual((await s.integrationStatus(t)).blockers,["req:blocked"]);
 await db.query(`UPDATE worker_assignments SET status='in_progress' WHERE task_id=$1`,[t]);await s.submitHandoff(t,"req",w,{v:1});assert.deepEqual((await s.integrationStatus(t)).blockers,["req:handed_off"]);
 await s.review({taskId:t,leadWorkerId:l,epoch:lead.epoch,assignmentId:"req",handoffId:"h1",decision:"rework"});assert.deepEqual((await s.integrationStatus(t)).blockers,["req:rework"]);
 const ev=(await db.query(`SELECT event_type,payload FROM lead_assignment_events WHERE task_id=$1`,[t])).rows;assert.ok(ev.some(x=>x.event_type==="HANDOFF_SUBMITTED"&&x.payload.handoff?.v===1));assert.ok(ev.some(x=>x.event_type==="REWORK_REQUIRED"&&x.payload.handoffId==="h1"));
 await s.submitHandoff(t,"req",w,{v:2});await s.review({taskId:t,leadWorkerId:l,epoch:lead.epoch,assignmentId:"req",handoffId:"h2",decision:"accepted"});assert.equal((await s.integrationStatus(t)).ready,true);
 await db.query(`UPDATE task_leadership SET lease_expires_at=now()-interval'1 second' WHERE task_id=$1`,[t]);assert.equal((await s.integrationStatus(t)).ready,false);
}finally{await db.end()}});

test("cross-task spawn target is rejected",{skip:!url},async()=>{const db=new Pool({connectionString:url!});try{
 const a=await task(db,"a"),b=await task(db,"b"),l=await worker(db,a,"lead"),foreign=await spawn(db,b),s=new LeadOrchestrationStore(db),lead=await s.acquireLeadership(a,l,60000);
 await assert.rejects(s.assign({taskId:a,leadWorkerId:l,epoch:lead.epoch,externalId:"x",idempotencyKey:randomUUID(),spawnRequestId:foreign,objective:"x",assignment:{},acceptanceCriteria:[],dependencies:[],required:true}),e=>e instanceof LeadOrchestrationError);
 assert.equal((await db.query(`SELECT count(*)::int n FROM worker_assignments WHERE task_id=$1 AND external_id='x'`,[a])).rows[0].n,0);
}finally{await db.end()}});

test("schema/runtime Lead authorities match; authoritative messages require positive epoch",()=>{
 const schema=JSON.parse(readFileSync(new URL("../schemas/sentient-worker-contract.v1.schema.json",import.meta.url),"utf8")),sa=schema.properties.authority.items.enum as string[];assert.deepEqual(new Set(sa),new Set(AUTHORITIES));for(const a of Object.values(LEAD_AUTHORITY_BY_MESSAGE))if(a)assert.ok(sa.includes(a));
 const c=validateWorkerContract({protocolVersion:"1.0",workerId:"l",taskId:"t",tenantId:"tenant-a",repositoryId:"riggeyb/skills",role:"lead",objective:"x",assignment:"x",constraints:[],dependencies:[],capabilities:[],authority:[...AUTHORITIES],resourceClaims:[],budget:{},allowedTools:[],modelRuntimeRequirements:{},completionCriteria:[],reportingRequirements:[]});
 const m={protocolVersion:"1.0",messageId:"m",type:"ASSIGNMENT",taskId:"t",senderWorkerId:"l",correlationId:"c",repositoryId:"riggeyb/skills",tenantId:"tenant-a",createdAt:"2026-09-23T19:00:00Z",payload:{leadershipEpoch:1,assignmentId:"a",idempotencyKey:"k",targetWorkerId:"w",objective:"x",assignment:{},acceptanceCriteria:[],dependencies:[],required:true}};
 assert.equal(validateMessage(m,{contract:c}).type,"ASSIGNMENT");for(const [field,code] of [["taskId","CROSS_TASK"],["tenantId","CROSS_TENANT"],["repositoryId","CROSS_REPOSITORY"]] as const)assert.throws(()=>validateMessage({...m,[field]:"other"},{contract:c}),e=>e instanceof ProtocolValidationError&&e.code===code);
 assert.throws(()=>validateMessage({...m,payload:{...m.payload,leadershipEpoch:0}},{contract:c}),e=>e instanceof ProtocolValidationError&&e.code==="MALFORMED");
 assert.throws(()=>assertAuthority({...c,role:"specialist",authority:["repository:read"]},"workers:assign"),e=>e instanceof ProtocolValidationError&&e.code==="AUTHORITY_VIOLATION");
});
