import type { Pool, PoolClient } from "pg";
import {
  LEAD_AUTHORITY_BY_MESSAGE, assertAuthority, validateMessage, validateWorkerContract,
  type AssignmentPayload, type DirectivePayload, type IntegrationReadyPayload,
  type JsonValue, type ReviewDecisionPayload, type WorkerContract,
} from "./worker-protocol.js";

export class LeadOrchestrationError extends Error {
  constructor(public readonly code:string,message:string){super(message)}
}
export interface LeadershipRecord{taskId:string;leadWorkerId:string;epoch:number;leaseExpiresAt:string}
export interface IntegrationStatus{ready:boolean;blockers:string[];pendingAssignments:string[]}
const iso=(v:any)=>v instanceof Date?v.toISOString():new Date(v).toISOString();

export class LeadOrchestrationStore{
  constructor(private readonly db:Pool){}

  async assertContractBinding(c:WorkerContract){
    const r=await this.db.query(`SELECT task_id,tenant,repository_owner,repository_name,role FROM sentient_workers WHERE id=$1`,[c.workerId]);
    if(r.rowCount!==1)throw new LeadOrchestrationError("UNKNOWN_WORKER","unknown worker");
    const x=r.rows[0];
    if(x.task_id!==c.taskId)throw new LeadOrchestrationError("CROSS_TASK","task mismatch");
    if(x.tenant!==c.tenantId)throw new LeadOrchestrationError("CROSS_TENANT","tenant mismatch");
    if(`${x.repository_owner}/${x.repository_name}`!==c.repositoryId)throw new LeadOrchestrationError("CROSS_REPOSITORY","repository mismatch");
    if(x.role!==c.role)throw new LeadOrchestrationError("ROLE_MISMATCH","role mismatch");
  }

  async acquireLeadership(taskId:string,workerId:string,leaseMs:number):Promise<LeadershipRecord>{
    if(leaseMs<=0)throw new LeadOrchestrationError("INVALID_LEASE","lease must be positive");
    const w=await this.db.query(`SELECT task_id,role,status FROM sentient_workers WHERE id=$1`,[workerId]);
    if(w.rowCount!==1||w.rows[0].task_id!==taskId||w.rows[0].role!=="lead"||w.rows[0].status!=="running")
      throw new LeadOrchestrationError("INVALID_LEAD","lead must be a running lead worker on the task");
    const r=await this.db.query(
      `INSERT INTO task_leadership(task_id,lead_worker_id,epoch,lease_expires_at)
       VALUES($1,$2,1,now()+$3*interval '1 millisecond')
       ON CONFLICT(task_id) DO UPDATE SET
         lead_worker_id=EXCLUDED.lead_worker_id,
         epoch=CASE
           WHEN task_leadership.lead_worker_id=EXCLUDED.lead_worker_id AND task_leadership.lease_expires_at>now()
             THEN task_leadership.epoch
           ELSE task_leadership.epoch+1
         END,
         lease_expires_at=EXCLUDED.lease_expires_at,renewed_at=now(),updated_at=now(),
         integration_ready_at=CASE
           WHEN task_leadership.lead_worker_id=EXCLUDED.lead_worker_id AND task_leadership.lease_expires_at>now()
             THEN task_leadership.integration_ready_at
           ELSE NULL
         END,
         integration_ready_epoch=CASE
           WHEN task_leadership.lead_worker_id=EXCLUDED.lead_worker_id AND task_leadership.lease_expires_at>now()
             THEN task_leadership.integration_ready_epoch
           ELSE NULL
         END
       WHERE task_leadership.lead_worker_id=EXCLUDED.lead_worker_id OR task_leadership.lease_expires_at<=now()
       RETURNING *`,[taskId,workerId,leaseMs]);
    if(r.rowCount!==1)throw new LeadOrchestrationError("LEADERSHIP_HELD","another active lead owns the task");
    const x=r.rows[0];await this.audit(taskId,"LEAD_ACQUIRED",workerId,{epoch:x.epoch});
    return{taskId:x.task_id,leadWorkerId:x.lead_worker_id,epoch:+x.epoch,leaseExpiresAt:iso(x.lease_expires_at)};
  }

  async assertActiveLead(taskId:string,workerId:string,epoch:number){
    const r=await this.db.query(`SELECT 1 FROM task_leadership WHERE task_id=$1 AND lead_worker_id=$2 AND epoch=$3 AND lease_expires_at>now()`,[taskId,workerId,epoch]);
    if(r.rowCount!==1)throw new LeadOrchestrationError("STALE_LEAD","not active lead for epoch");
  }

  private async assertActiveLeadTx(c:PoolClient,taskId:string,workerId:string,epoch:number){
    const r=await c.query(`SELECT 1 FROM task_leadership WHERE task_id=$1 AND lead_worker_id=$2 AND epoch=$3 AND lease_expires_at>now() FOR UPDATE`,[taskId,workerId,epoch]);
    if(r.rowCount!==1)throw new LeadOrchestrationError("STALE_LEAD","not active lead for epoch");
  }

  async assign(i:{taskId:string;leadWorkerId:string;epoch:number;externalId:string;idempotencyKey:string;targetWorkerId?:string;spawnRequestId?:string;objective:string;assignment:JsonValue;acceptanceCriteria:JsonValue;dependencies:string[];required:boolean}){
    const c=await this.db.connect();try{
      await c.query("BEGIN");await this.assertActiveLeadTx(c,i.taskId,i.leadWorkerId,i.epoch);
      if(i.targetWorkerId){
        const t=await c.query(`SELECT 1 FROM sentient_workers WHERE id=$1 AND task_id=$2`,[i.targetWorkerId,i.taskId]);
        if(t.rowCount!==1)throw new LeadOrchestrationError("INVALID_TARGET","target worker is outside task");
      }
      if(i.spawnRequestId){
        const s=await c.query(`SELECT 1 FROM worker_spawn_requests WHERE id=$1 AND task_id=$2`,[i.spawnRequestId,i.taskId]);
        if(s.rowCount!==1)throw new LeadOrchestrationError("INVALID_TARGET","spawn request is outside task");
      }
      const r=await c.query(
        `INSERT INTO worker_assignments(external_id,task_id,lead_worker_id,leadership_epoch,target_worker_id,spawn_request_id,idempotency_key,objective,assignment,acceptance_criteria,dependencies,required)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12)
         ON CONFLICT(task_id,idempotency_key) DO NOTHING RETURNING *`,
        [i.externalId,i.taskId,i.leadWorkerId,i.epoch,i.targetWorkerId??null,i.spawnRequestId??null,i.idempotencyKey,i.objective,JSON.stringify(i.assignment),JSON.stringify(i.acceptanceCriteria),JSON.stringify(i.dependencies),i.required]);
      let row=r.rows[0];
      if(!row){
        const e=await c.query(`SELECT * FROM worker_assignments WHERE task_id=$1 AND idempotency_key=$2`,[i.taskId,i.idempotencyKey]);
        row=e.rows[0];if(!row||row.external_id!==i.externalId)throw new LeadOrchestrationError("IDEMPOTENCY_CONFLICT","assignment key already bound");
      }else{
        await this.event(c,i.taskId,row.id,i.leadWorkerId,i.epoch,"WORKER_ASSIGNED",`worker:${i.leadWorkerId}`,{assignmentId:i.externalId});
        await this.auditTx(c,i.taskId,"WORKER_ASSIGNED",i.leadWorkerId,{assignmentId:i.externalId,epoch:i.epoch});
      }
      await c.query("COMMIT");return row;
    }catch(e){await c.query("ROLLBACK");throw e}finally{c.release()}
  }

  async submitHandoff(taskId:string,assignmentId:string,workerId:string,handoff:unknown){
    const c=await this.db.connect();try{
      await c.query("BEGIN");
      const r=await c.query(`SELECT * FROM worker_assignments WHERE task_id=$1 AND external_id=$2 FOR UPDATE`,[taskId,assignmentId]);
      if(r.rowCount!==1)throw new LeadOrchestrationError("UNKNOWN_ASSIGNMENT","assignment not found");
      const x=r.rows[0];
      if(x.target_worker_id!==workerId)throw new LeadOrchestrationError("ASSIGNMENT_OWNERSHIP","worker does not own assignment");
      if(!["assigned","acknowledged","in_progress","blocked","rework"].includes(x.status))throw new LeadOrchestrationError("INVALID_ASSIGNMENT_STATE","assignment cannot be handed off");
      if(handoff===null||typeof handoff!=="object"||Array.isArray(handoff)||typeof (handoff as {handoffId?:unknown}).handoffId!=="string"||(handoff as {handoffId:string}).handoffId.length===0)
        throw new LeadOrchestrationError("UNKNOWN_HANDOFF","handoffId is required");
      await c.query(`UPDATE worker_assignments SET status='handed_off',handoff=$2::jsonb,updated_at=now() WHERE id=$1`,[x.id,JSON.stringify(handoff)]);
      await this.event(c,taskId,x.id,x.lead_worker_id,x.leadership_epoch,"HANDOFF_SUBMITTED",`worker:${workerId}`,{handoff});
      await c.query("COMMIT");
    }catch(e){await c.query("ROLLBACK");throw e}finally{c.release()}
  }

  async review(i:{taskId:string;leadWorkerId:string;epoch:number;assignmentId:string;handoffId:string;decision:"accepted"|"rework"|"rejected";reason?:string}){
    const c=await this.db.connect();try{
      await c.query("BEGIN");await this.assertActiveLeadTx(c,i.taskId,i.leadWorkerId,i.epoch);
      const r=await c.query(`SELECT * FROM worker_assignments WHERE task_id=$1 AND external_id=$2 FOR UPDATE`,[i.taskId,i.assignmentId]);
      if(r.rowCount!==1||r.rows[0].status!=="handed_off")throw new LeadOrchestrationError("INVALID_ASSIGNMENT_STATE","handoff not awaiting review");
      const storedHandoffId=r.rows[0].handoff?.handoffId;
      if(typeof storedHandoffId!=="string"||storedHandoffId.length===0)throw new LeadOrchestrationError("UNKNOWN_HANDOFF","stored handoff has no handoffId");
      if(storedHandoffId!==i.handoffId)throw new LeadOrchestrationError("HANDOFF_MISMATCH","review does not reference the submitted handoff");
      const status=i.decision==="accepted"?"accepted":"rework",review={handoffId:i.handoffId,decision:i.decision,reason:i.reason??null};
      await c.query(`UPDATE worker_assignments SET status=$2,last_review=$3::jsonb,revision=CASE WHEN $2='rework' THEN revision+1 ELSE revision END,updated_at=now() WHERE id=$1`,[r.rows[0].id,status,JSON.stringify(review)]);
      const ev=i.decision==="accepted"?"HANDOFF_ACCEPTED":"REWORK_REQUIRED";
      await this.event(c,i.taskId,r.rows[0].id,i.leadWorkerId,i.epoch,ev,`worker:${i.leadWorkerId}`,review);await this.auditTx(c,i.taskId,ev,i.leadWorkerId,{assignmentId:i.assignmentId,...review});
      await c.query("COMMIT");
    }catch(e){await c.query("ROLLBACK");throw e}finally{c.release()}
  }

  async directive(i:{taskId:string;leadWorkerId:string;epoch:number;externalId:string;idempotencyKey:string;assignmentId?:string;directiveType:string;payload:JsonValue}){
    const c=await this.db.connect();try{
      await c.query("BEGIN");await this.assertActiveLeadTx(c,i.taskId,i.leadWorkerId,i.epoch);
      let aid:null|string=null;
      if(i.assignmentId){const a=await c.query(`SELECT id FROM worker_assignments WHERE task_id=$1 AND external_id=$2`,[i.taskId,i.assignmentId]);if(a.rowCount!==1)throw new LeadOrchestrationError("UNKNOWN_ASSIGNMENT","assignment not found");aid=a.rows[0].id}
      const r=await c.query(`INSERT INTO lead_directives(external_id,task_id,lead_worker_id,leadership_epoch,assignment_id,directive_type,payload,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8) ON CONFLICT(task_id,idempotency_key) DO NOTHING RETURNING id`,[i.externalId,i.taskId,i.leadWorkerId,i.epoch,aid,i.directiveType,JSON.stringify(i.payload),i.idempotencyKey]);
      if(!r.rowCount){const e=await c.query(`SELECT external_id FROM lead_directives WHERE task_id=$1 AND idempotency_key=$2`,[i.taskId,i.idempotencyKey]);if(e.rows[0]?.external_id!==i.externalId)throw new LeadOrchestrationError("IDEMPOTENCY_CONFLICT","directive key already bound")}
      await this.auditTx(c,i.taskId,"WORKER_REDIRECTED",i.leadWorkerId,{directiveId:i.externalId,type:i.directiveType,epoch:i.epoch});await c.query("COMMIT");
    }catch(e){await c.query("ROLLBACK");throw e}finally{c.release()}
  }

  async integrationStatus(taskId:string):Promise<IntegrationStatus>{
    const l=await this.db.query(`SELECT 1 FROM task_leadership WHERE task_id=$1 AND lease_expires_at>now()`,[taskId]);
    const p=await this.db.query(`SELECT external_id,status FROM worker_assignments WHERE task_id=$1 AND required=true AND status<>'accepted' ORDER BY created_at`,[taskId]);
    const pending=p.rows.map(x=>x.external_id as string),blockers=p.rows.filter(x=>["blocked","handed_off","rework"].includes(x.status)).map(x=>`${x.external_id}:${x.status}`);
    if(!l.rowCount)blockers.unshift("no_active_lead");
    return{ready:l.rowCount===1&&pending.length===0,blockers,pendingAssignments:pending};
  }

  async markIntegrationReady(taskId:string,workerId:string,epoch:number){
    const c=await this.db.connect();try{
      await c.query("BEGIN");await this.assertActiveLeadTx(c,taskId,workerId,epoch);
      const p=await c.query(`SELECT external_id,status FROM worker_assignments WHERE task_id=$1 AND required=true AND status<>'accepted'`,[taskId]);
      if(p.rowCount)throw new LeadOrchestrationError("NOT_READY","required assignments remain");
      await c.query(`UPDATE task_leadership SET integration_ready_at=now(),integration_ready_epoch=$2,updated_at=now() WHERE task_id=$1`,[taskId,epoch]);
      await this.auditTx(c,taskId,"INTEGRATION_READY",workerId,{epoch});await c.query("COMMIT");
    }catch(e){await c.query("ROLLBACK");throw e}finally{c.release()}
  }

  private async event(c:PoolClient,taskId:string,assignmentId:string|null,leadId:string|null,epoch:number|null,type:string,actor:string,payload:unknown){
    await c.query(`INSERT INTO lead_assignment_events(task_id,assignment_id,lead_worker_id,leadership_epoch,event_type,actor,payload) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,[taskId,assignmentId,leadId,epoch,type,actor,JSON.stringify(payload??{})]);
  }
  private async audit(taskId:string,type:string,workerId:string,details:unknown){await this.db.query(`INSERT INTO audit_events(task_id,event_type,actor,details) VALUES($1,$2,$3,$4::jsonb)`,[taskId,type,`worker:${workerId}`,JSON.stringify(details??{})])}
  private async auditTx(c:PoolClient,taskId:string,type:string,workerId:string,details:unknown){await c.query(`INSERT INTO audit_events(task_id,event_type,actor,details) VALUES($1,$2,$3,$4::jsonb)`,[taskId,type,`worker:${workerId}`,JSON.stringify(details??{})])}
}

export class LeadSentientService{
  constructor(private readonly store:LeadOrchestrationStore){}
  async acquireLead(contractInput:unknown,leaseMs:number){
    const c=validateWorkerContract(contractInput);if(c.role!=="lead")throw new LeadOrchestrationError("INVALID_LEAD","lead role required");
    assertAuthority(c,"leadership:acquire");await this.store.assertContractBinding(c);return this.store.acquireLeadership(c.taskId,c.workerId,leaseMs);
  }
  async admitLeadMessage(contractInput:unknown,messageInput:unknown){
    const c=validateWorkerContract(contractInput);if(c.role!=="lead")throw new LeadOrchestrationError("INVALID_LEAD","lead role required");
    const m=validateMessage(messageInput,{contract:c}),required=LEAD_AUTHORITY_BY_MESSAGE[m.type];if(!required)throw new LeadOrchestrationError("UNSUPPORTED_LEAD_COMMAND",m.type);
    assertAuthority(c,required);await this.store.assertContractBinding(c);
    if(m.type==="ASSIGNMENT"){const p=m.payload as unknown as AssignmentPayload;return this.store.assign({taskId:c.taskId,leadWorkerId:c.workerId,epoch:p.leadershipEpoch,externalId:p.assignmentId,idempotencyKey:p.idempotencyKey,targetWorkerId:p.targetWorkerId,spawnRequestId:p.spawnRequestId,objective:p.objective,assignment:p.assignment,acceptanceCriteria:p.acceptanceCriteria,dependencies:p.dependencies,required:p.required})}
    if(m.type==="DIRECTIVE"){const p=m.payload as unknown as DirectivePayload;return this.store.directive({taskId:c.taskId,leadWorkerId:c.workerId,epoch:p.leadershipEpoch,externalId:p.directiveId,idempotencyKey:p.idempotencyKey,assignmentId:p.assignmentId,directiveType:p.directiveType,payload:p.payload})}
    if(m.type==="REVIEW_DECISION"){const p=m.payload as unknown as ReviewDecisionPayload;return this.store.review({taskId:c.taskId,leadWorkerId:c.workerId,epoch:p.leadershipEpoch,assignmentId:p.assignmentId,handoffId:p.handoffId,decision:p.decision,reason:p.reason})}
    const p=m.payload as unknown as IntegrationReadyPayload;return this.store.markIntegrationReady(c.taskId,c.workerId,p.leadershipEpoch);
  }
  async handoff(contractInput:unknown,assignmentId:string,handoff:unknown){
    const c=validateWorkerContract(contractInput);await this.store.assertContractBinding(c);return this.store.submitHandoff(c.taskId,assignmentId,c.workerId,handoff);
  }
  integrationStatus(taskId:string){return this.store.integrationStatus(taskId)}
}
