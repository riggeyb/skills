import type { Pool, PoolClient } from "pg";

const ACTIVE_TASKS = ["queued","planning","running","reviewing"] as const;

export class CoordinationActivationWatchdog {
  constructor(private readonly db: Pool) {}

  async tick(): Promise<number> {
    return (await this.repairWakeups()) +
      (await this.deadLetterTerminalRecipients()) +
      (await this.exhaustDeliveryRetries());
  }

  async repairWakeups(): Promise<number> {
    const inserted=await this.db.query(
      `INSERT INTO sentient_coordination_activations(
         activation_id,message_id,recipient_worker_id,next_attempt_at
       )
       SELECT 'coord:'||d.message_id::text||':'||d.recipient_worker_id::text,
              d.message_id,d.recipient_worker_id,d.next_delivery_at
       FROM sentient_coordination_deliveries d
       JOIN sentient_workers w ON w.id=d.recipient_worker_id
       JOIN tasks t ON t.id=w.task_id
       WHERE d.state IN('pending','delivered')
         AND w.status NOT IN('completed','failed','cancelled','expired')
         AND t.status=ANY($1::text[])
       ON CONFLICT(message_id,recipient_worker_id) DO NOTHING
       RETURNING activation_id`,[ACTIVE_TASKS]);
    const reset=await this.db.query(
      `UPDATE sentient_coordination_activations a
       SET state='pending',next_attempt_at=d.next_delivery_at,
           claim_owner=NULL,claim_expires_at=NULL,runtime_handle=NULL,
           updated_at=now(),completed_at=NULL
       FROM sentient_coordination_deliveries d
       JOIN sentient_workers w ON w.id=d.recipient_worker_id
       JOIN tasks t ON t.id=w.task_id
       WHERE a.message_id=d.message_id AND a.recipient_worker_id=d.recipient_worker_id
         AND a.state='completed' AND d.state IN('pending','delivered')
         AND d.next_delivery_at<=now()
         AND w.status NOT IN('completed','failed','cancelled','expired')
         AND t.status=ANY($1::text[])
       RETURNING a.activation_id`,[ACTIVE_TASKS]);
    return (inserted.rowCount ?? 0)+(reset.rowCount ?? 0);
  }

  async deadLetterTerminalRecipients():Promise<number>{
    const rows=await this.db.query(
      `SELECT d.message_id,d.recipient_worker_id,w.task_id,
              CASE WHEn w.status IN('completed','failed','cancelled','expired')
                   THEN 'recipient_terminal' ELSE 'task_terminal' END reason
       FROM sentient_coordination_deliveries d
       JOIN sentient_workers w ON w.id=d.recipient_worker_id
       JOIN tasks t ON t.id=w.task_id
       WHERE d.state IN('pending','delivered')
         AND (w.status IN('completed','failed','cancelled','expired')
              OR t.status NOT IN('queued','planning','running','reviewing'))`);
    let changed=0;
    for(const row of rows.rows){
      changed+=await deadLetterCoordinationDelivery(
        this.db,row.message_id,row.recipient_worker_id,row.task_id,row.reason);
    }
    return changed;
  }

  async exhaustDeliveryRetries():Promise<number>{
    const rows=await this.db.query(
      `SELECT d.message_id,d.recipient_worker_id,w.task_id
       FROM sentient_coordination_deliveries d
       JOIN sentient_workers w ON w.id=d.recipient_worker_id
       WHERE d.state='delivered'
         AND d.delivery_attempts>=d.max_delivery_attempts
         AND d.next_delivery_at<=now()
         AND NOT EXISTS(
           SELECT 1 FROM sentient_coordination_activations a
           WHERE a.message_id=d.message_id
             AND a.recipient_worker_id=d.recipient_worker_id
             AND a.state IN('claimed','running'))`);
    let changed=0;
    for(const row of rows.rows){
      changed+=await deadLetterCoordinationDelivery(
        this.db,row.message_id,row.recipient_worker_id,row.task_id,"delivery_retry_exhausted");
    }
    return changed;
  }
}

export async function deadLetterCoordinationDelivery(
  db:Pool,messageId:string,workerId:string,taskId:string,reason:string,
):Promise<number>{
  const client=await db.connect();
  try{
    await client.query("BEGIN");
    const changed=await deadLetterCoordinationDeliveryTx(client,messageId,workerId,taskId,reason);
    await client.query("COMMIT");
    return changed;
  }catch(error){
    await client.query("ROLLBACK");
    throw error;
  }finally{client.release();}
}

export async function deadLetterCoordinationDeliveryTx(
  client:PoolClient,messageId:string,workerId:string,taskId:string,reason:string,
):Promise<number>{
  const delivery=await client.query(
    `UPDATE sentient_coordination_deliveries
     SET state='dead_letter',dead_letter_reason=$3,
         dead_lettered_at=coalesce(dead_lettered_at,now())
     WHERE message_id=$1 AND recipient_worker_id=$2 AND state<>'dead_letter'
     RETURNING message_id`,[messageId,workerId,reason]);
  if(!delivery.rowCount)return 0;
  await client.query(
    `UPDATE sentient_coordination_activations
     SET state='dead_letter',claim_owner=NULL,claim_expires_at=NULL,runtime_handle=NULL,
         last_error=$3,completed_at=now(),updated_at=now()
     WHERE message_id=$1 AND recipient_worker_id=$2 AND state<>'dead_letter'`,
    [messageId,workerId,reason]);
  await client.query(
    `INSERT INTO audit_events(task_id,event_type,actor,details)
     VALUES($1,'COORDINATION_DELIVERY_DEAD_LETTERED',$2,$3::jsonb)`,
    [taskId,`worker:${workerId}`,JSON.stringify({messageId,reason})]);
  await client.query(
    `INSERT INTO task_messages(task_id,role,body) VALUES($1,'system',$2)`,
    [taskId,`Sentient coordination delivery ${messageId} to worker ${workerId} dead-lettered: ${reason}.`]);
  return 1;
}
