import type { Pool } from "pg";
import { deadLetterCoordinationDeliveryTx } from "./coordination-activation-watchdog.js";

export class CoordinationActivationSettlementStore{
  constructor(readonly db:Pool){}

  async finish(
    activationId:string,handle:string,runtimeCompleted:boolean,reason:string|undefined,
    spentUsd:number,retryBackoffMs:number,
  ):Promise<void>{
    if(!Number.isFinite(spentUsd)||spentUsd<0)throw new Error("coordination_runtime_reported_invalid_spend");
    const c=await this.db.connect();
    try{
      await c.query("BEGIN");
      const r=await c.query(
        `SELECT a.*,d.state delivery_state,d.delivery_attempts,d.max_delivery_attempts,d.next_delivery_at,
                w.task_id
         FROM sentient_coordination_activations a
         JOIN sentient_coordination_deliveries d
           ON d.message_id=a.message_id AND d.recipient_worker_id=a.recipient_worker_id
         JOIN sentient_workers w ON w.id=a.recipient_worker_id
         WHERE a.activation_id=$1 FOR UPDATE OF a,d,w`,[activationId]);
      if(r.rowCount!==1||r.rows[0].state!=="running"||r.rows[0].runtime_handle!==handle){
        await c.query("ROLLBACK");return;
      }
      const row=r.rows[0];
      await c.query(
        `UPDATE sentient_workers
         SET spent_usd=spent_usd+$2,
             status=CASE WHEN status='running' AND runtime_handle=$3 THEN 'waiting' ELSE status END,
             runtime_handle=CASE WHEN runtime_handle=$3 THEN NULL ELSE runtime_handle END,
             lease_owner=CASE WHEN runtime_handle=$3 THEN NULL ELSE lease_owner END,
             lease_expires_at=CASE WHEN runtime_handle=$3 THEN NULL ELSE lease_expires_at END
         WHERE id=$1`,[row.recipient_worker_id,spentUsd,handle]);
      if(row.delivery_state==="acknowledged"){
        await c.query(
          `UPDATE sentient_coordination_activations
           SET state='completed',claim_owner=NULL,claim_expires_at=NULL,runtime_handle=NULL,
               last_error=$2,completed_at=now(),updated_at=now()
           WHERE activation_id=$1`,[activationId,reason??null]);
      }else if(Number(row.activation_attempts)>=Number(row.max_activation_attempts)||
               Number(row.delivery_attempts)>=Number(row.max_delivery_attempts)){
        await deadLetterCoordinationDeliveryTx(
          c,row.message_id,row.recipient_worker_id,row.task_id,
          runtimeCompleted?"coordination_ack_retry_exhausted":reason??"coordination_activation_retry_exhausted");
      }else{
        await c.query(
          `UPDATE sentient_coordination_activations
           SET state='pending',claim_owner=NULL,claim_expires_at=NULL,runtime_handle=NULL,
               last_error=$2,next_attempt_at=greatest($3::timestamptz,now()+$4*interval '1 millisecond'),
               updated_at=now()
           WHERE activation_id=$1`,
          [activationId,reason??null,row.next_delivery_at,retryBackoffMs]);
      }
      await c.query(
        `INSERT INTO audit_events(task_id,event_type,actor,details)
         VALUES($1,'COORDINATION_ACTIVATION_FINISHED',$2,$3::jsonb)`,
        [row.task_id,`worker:${row.recipient_worker_id}`,
         JSON.stringify({activationId,runtimeCompleted,reason:reason??null,spentUsd})]);
      await c.query("COMMIT");
    }catch(error){await c.query("ROLLBACK");throw error}finally{c.release()}
  }

  async fail(
    activationId:string,reason:string,forceDeadLetter:boolean,retryBackoffMs:number,
  ):Promise<void>{
    const c=await this.db.connect();
    try{
      await c.query("BEGIN");
      const r=await c.query(
        `SELECT a.*,w.task_id FROM sentient_coordination_activations a
         JOIN sentient_workers w ON w.id=a.recipient_worker_id
         WHERE a.activation_id=$1 FOR UPDATE OF a`,[activationId]);
      if(r.rowCount!==1){await c.query("ROLLBACK");return}
      const row=r.rows[0];
      if(row.state==="running"&&row.runtime_handle){
        await c.query(
          `UPDATE sentient_workers
           SET status=CASE WHEN status='running' AND runtime_handle=$2 THEN 'waiting' ELSE status END,
               runtime_handle=CASE WHEN runtime_handle=$2 THEN NULL ELSE runtime_handle END,
               lease_owner=CASE WHEN runtime_handle=$2 THEN NULL ELSE lease_owner END,
               lease_expires_at=CASE WHEN runtime_handle=$2 THEN NULL ELSE lease_expires_at END
           WHERE id=$1`,
          [row.recipient_worker_id,row.runtime_handle]);
      }
      if(forceDeadLetter||Number(row.activation_attempts)>=Number(row.max_activation_attempts)){
        await deadLetterCoordinationDeliveryTx(c,row.message_id,row.recipient_worker_id,row.task_id,reason);
      }else{
        await c.query(
          `UPDATE sentient_coordination_activations
           SET state='pending',claim_owner=NULL,claim_expires_at=NULL,runtime_handle=NULL,
               last_error=$2,next_attempt_at=now()+$3*interval '1 millisecond',updated_at=now()
           WHERE activation_id=$1`,[activationId,reason,retryBackoffMs]);
      }
      await c.query("COMMIT");
    }catch(error){await c.query("ROLLBACK");throw error}finally{c.release()}
  }
}