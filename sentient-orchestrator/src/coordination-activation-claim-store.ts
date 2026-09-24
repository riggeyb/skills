import type { Pool } from "pg";

const ACTIVE_TASKS=["queued","planning","running","reviewing"] as const;

export interface CoordinationActivationRow{
  activation_id:string;
  message_id:string;
  recipient_worker_id:string;
  activation_attempts:number;
  max_activation_attempts:number;
}

export class CoordinationActivationClaimStore{
  constructor(readonly db:Pool){}

  async claim(owner:string,leaseMs:number):Promise<CoordinationActivationRow|null>{
    try{
      const r=await this.db.query(
        `WITH candidate AS(
           SELECT a.activation_id
           FROM sentient_coordination_activations a
           JOIN sentient_coordination_deliveries d
             ON d.message_id=a.message_id AND d.recipient_worker_id=a.recipient_worker_id
           JOIN sentient_workers w ON w.id=a.recipient_worker_id
           JOIN tasks t ON t.id=w.task_id
           WHERE a.state='pending' AND a.next_attempt_at<=now()
             AND a.activation_attempts<a.max_activation_attempts
             AND d.state IN('pending','delivered') AND d.next_delivery_at<=now()
             AND d.delivery_attempts<d.max_delivery_attempts
             AND w.status IN('waiting','blocked') AND w.runtime_handle IS NULL
             AND t.status=ANY($1::text[])
             AND NOT EXISTS(
               SELECT 1 FROM sentient_coordination_activations x
               WHERE x.recipient_worker_id=a.recipient_worker_id
                 AND x.state IN('claimed','running'))
           ORDER BY a.next_attempt_at,a.created_at,a.activation_id
           FOR UPDATE OF a SKIP LOCKED LIMIT 1
         )
         UPDATE sentient_coordination_activations a
         SET state='claimed',activation_attempts=a.activation_attempts+1,
             claim_owner=$2,claim_expires_at=now()+$3*interval '1 millisecond',updated_at=now()
         WHERE a.activation_id=(SELECT activation_id FROM candidate)
         RETURNING a.*`,[ACTIVE_TASKS,owner,leaseMs]);
      return (r.rows[0] as CoordinationActivationRow|undefined)??null;
    }catch(error:any){
      if(error?.code==="23505")return null;
      throw error;
    }
  }

  async recoverExpiredClaims(owner:string,leaseMs:number):Promise<number>{
    const rows=await this.db.query(
      `SELECT activation_id,recipient_worker_id,activation_attempts
       FROM sentient_coordination_activations
       WHERE state='claimed' AND claim_expires_at<=now()
       ORDER BY updated_at,activation_id`);
    let changed=0;
    for(const row of rows.rows){
      const execution=await this.db.query(
        `SELECT runtime_handle FROM worker_coordination_runtime_executions
         WHERE activation_id=$1 AND execution_attempt=$2`,
        [row.activation_id,row.activation_attempts]);
      if(execution.rowCount===1){
        if(await this.bindRunning(
          row.activation_id,row.recipient_worker_id,execution.rows[0].runtime_handle,owner,leaseMs,true
        ))changed++;
        continue;
      }
      const reset=await this.db.query(
        `UPDATE sentient_coordination_activations
         SET state='pending',activation_attempts=greatest(activation_attempts-1,0),
             claim_owner=NULL,claim_expires_at=NULL,next_attempt_at=now(),
             last_error='activation_claim_expired_before_runtime_start',updated_at=now()
         WHERE activation_id=$1 AND state='claimed' AND claim_expires_at<=now()
         RETURNING activation_id`,[row.activation_id]);
      changed+=reset.rowCount;
    }
    return changed;
  }

  async running(limit:number){
    return (await this.db.query(
      `SELECT activation_id,recipient_worker_id,runtime_handle
       FROM sentient_coordination_activations
       WHERE state='running' AND runtime_handle IS NOT NULL
       ORDER BY updated_at,activation_id LIMIT $1`,[limit])).rows as
      Array<{activation_id:string;recipient_worker_id:string;runtime_handle:string}>;
  }

  async bindRunning(
    activationId:string,workerId:string,handle:string,owner:string,leaseMs:number,recovering=false,
  ):Promise<boolean>{
    const c=await this.db.connect();
    try{
      await c.query("BEGIN");
      const a=await c.query(
        `SELECT state,claim_owner FROM sentient_coordination_activations
         WHERE activation_id=$1 FOR UPDATE`,[activationId]);
      const w=await c.query(
        `SELECT task_id,status,runtime_handle FROM sentient_workers WHERE id=$1 FOR UPDATE`,[workerId]);
      if(a.rows[0]?.state!=="claimed"||(!recovering&&a.rows[0]?.claim_owner!==owner)||
         !w.rowCount||!["waiting","blocked"].includes(w.rows[0].status)||w.rows[0].runtime_handle){
        await c.query("ROLLBACK");return false;
      }
      await c.query(
        `UPDATE sentient_coordination_activations
         SET state='running',runtime_handle=$2,claim_owner=$3,
             claim_expires_at=now()+$4*interval '1 millisecond',updated_at=now()
         WHERE activation_id=$1`,[activationId,handle,owner,leaseMs]);
      await c.query(
        `UPDATE sentient_workers
         SET status='running',runtime_handle=$2,lease_owner=$3,
             lease_expires_at=now()+$4*interval '1 millisecond',
             started_at=coalesce(started_at,now())
         WHERE id=$1`,[workerId,handle,owner,leaseMs]);
      await c.query(
        `INSERT INTO audit_events(task_id,event_type,actor,details)
         VALUES($1,'COORDINATION_RECIPIENT_ACTIVATED',$2,$3::jsonb)`,
        [w.rows[0].task_id,`worker:${workerId}`,
         JSON.stringify({activationId,runtimeHandle:handle,recovering})]);
      await c.query("COMMIT");return true;
    }catch(error){await c.query("ROLLBACK");throw error}finally{c.release()}
  }
}
