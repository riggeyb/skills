import type { Pool, PoolClient } from "pg";
import { SENTIENT_PROTOCOL_VERSION } from "./worker-protocol.js";
import type {
  CoordinationActor, CoordinationDelivery, CoordinationDraft, SentientCoordinationMessage,
} from "./sentient-coordination-types.js";
import {
  CoordinationError, assertBoundary, assertIdempotentMessage, mapCoordinationMessage,
  type DurableCoordinationWorker,
} from "./sentient-coordination-validation.js";

const TERMINAL = new Set(["completed","failed","cancelled","expired"]);

export class SentientCoordinationStore {
  constructor(readonly db: Pool) {}

  async actor(c: PoolClient, actor: CoordinationActor): Promise<DurableCoordinationWorker> {
    const r = await c.query(
      `SELECT id,task_id,tenant,repository_owner,repository_name,role,status,correlation_id,attempt_count
       FROM sentient_workers WHERE id=$1`, [actor.workerId]);
    if (r.rowCount !== 1) throw new CoordinationError("UNKNOWN_WORKER","unknown worker");
    const row = r.rows[0] as DurableCoordinationWorker;
    if (actor.taskId !== row.task_id) throw new CoordinationError("CROSS_TASK","actor task mismatch");
    if (actor.tenant !== row.tenant) throw new CoordinationError("CROSS_TENANT","actor tenant mismatch");
    if (actor.repository.owner !== row.repository_owner || actor.repository.repo !== row.repository_name)
      throw new CoordinationError("CROSS_REPOSITORY","actor repository mismatch");
    if (actor.attemptCount !== undefined && actor.attemptCount !== Number(row.attempt_count))
      throw new CoordinationError("STALE_ATTEMPT","actor attempt mismatch");
    return row;
  }

  async activeLead(c: PoolClient, sender: DurableCoordinationWorker, epoch: number): Promise<void> {
    if (sender.role !== "lead") throw new CoordinationError("LEAD_AUTHORITY_REQUIRED","Lead role required");
    const r = await c.query(
      `SELECT 1 FROM task_leadership
       WHERE task_id=$1 AND lead_worker_id=$2 AND epoch=$3 AND lease_expires_at>now()
       FOR UPDATE`, [sender.task_id,sender.id,epoch]);
    if (r.rowCount !== 1) throw new CoordinationError("STALE_LEAD","not active Lead for epoch");
  }

  async causal(c: PoolClient, sender: DurableCoordinationWorker, id: string): Promise<void> {
    const r = await c.query(
      `SELECT task_id,tenant,repository_owner,repository_name
       FROM sentient_coordination_messages WHERE message_id=$1`, [id]);
    if (r.rowCount !== 1) throw new CoordinationError("UNKNOWN_CAUSAL_PARENT","causal parent not found");
    assertBoundary(r.rows[0], sender);
  }

  async recipients(c: PoolClient, sender: DurableCoordinationWorker, draft: CoordinationDraft): Promise<DurableCoordinationWorker[]> {
    if (draft.target.kind === "worker") {
      const r = await c.query(
        `SELECT id,task_id,tenant,repository_owner,repository_name,role,status,correlation_id,attempt_count
         FROM sentient_workers WHERE id=$1`, [draft.target.workerId]);
      if (r.rowCount !== 1) throw new CoordinationError("UNKNOWN_RECIPIENT","unknown recipient");
      const x = r.rows[0] as DurableCoordinationWorker;
      assertBoundary(x,sender);
      if (TERMINAL.has(x.status)) throw new CoordinationError("RECIPIENT_TERMINAL",`recipient is ${x.status}`);
      return [x];
    }
    if (draft.target.kind === "lead") {
      const r = await c.query(
        `SELECT w.id,w.task_id,w.tenant,w.repository_owner,w.repository_name,w.role,w.status,w.correlation_id,w.attempt_count
         FROM task_leadership l JOIN sentient_workers w ON w.id=l.lead_worker_id
         WHERE l.task_id=$1 AND l.lease_expires_at>now()`, [sender.task_id]);
      if (r.rowCount !== 1) throw new CoordinationError("NO_ACTIVE_LEAD","task has no active Lead");
      const x = r.rows[0] as DurableCoordinationWorker;
      assertBoundary(x,sender);
      if (TERMINAL.has(x.status)) throw new CoordinationError("RECIPIENT_TERMINAL",`Lead recipient is ${x.status}`);
      return [x];
    }
    const r = await c.query(
      `SELECT id,task_id,tenant,repository_owner,repository_name,role,status,correlation_id,attempt_count
       FROM sentient_workers
       WHERE task_id=$1 AND tenant=$2 AND repository_owner=$3 AND repository_name=$4
         AND id<>$5 AND status NOT IN('completed','failed','cancelled','expired')
       ORDER BY created_at,attempt_count,id`,
      [sender.task_id,sender.tenant,sender.repository_owner,sender.repository_name,sender.id]);
    return r.rows as DurableCoordinationWorker[];
  }

  async persist(
    c: PoolClient, sender: DurableCoordinationWorker, draft: CoordinationDraft,
    messageId: string, correlationId: string, recipients: DurableCoordinationWorker[],
  ): Promise<SentientCoordinationMessage> {
    const recipient = draft.target.kind === "worker" ? draft.target.workerId : null;
    const r = await c.query(
      `INSERT INTO sentient_coordination_messages(
         message_id,protocol_version,task_id,tenant,repository_owner,repository_name,sender_worker_id,
         target_kind,recipient_worker_id,message_type,correlation_id,causation_id,payload,sender_leadership_epoch)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)
       ON CONFLICT(message_id) DO NOTHING RETURNING *`,
      [messageId,SENTIENT_PROTOCOL_VERSION,sender.task_id,sender.tenant,sender.repository_owner,sender.repository_name,
       sender.id,draft.target.kind,recipient,draft.type,correlationId,draft.causationId??null,
       JSON.stringify(draft.payload),draft.leadershipEpoch??null]);
    let row = r.rows[0];
    if (!row) {
      const e = await c.query(`SELECT * FROM sentient_coordination_messages WHERE message_id=$1 FOR UPDATE`,[messageId]);
      if (e.rowCount !== 1) throw new CoordinationError("MESSAGE_ID_CONFLICT","message id conflict");
      row = e.rows[0];
      assertIdempotentMessage(row,sender,draft,correlationId);
    }
    for (const x of recipients) {
      await c.query(
        `INSERT INTO sentient_coordination_deliveries(message_id,recipient_worker_id)
         VALUES($1,$2) ON CONFLICT DO NOTHING`, [messageId,x.id]);
      await c.query(
        `INSERT INTO sentient_coordination_activations(
           activation_id,message_id,recipient_worker_id
         )
         VALUES('coord:' || $1::text || ':' || $2::text,$1,$2)
         ON CONFLICT(message_id,recipient_worker_id) DO NOTHING`,
        [messageId,x.id],
      );
    }
    if (r.rowCount) await this.audit(c,sender.task_id,sender.id,"COORDINATION_MESSAGE_SENT",{
      messageId,type:draft.type,targetKind:draft.target.kind,recipients:recipients.map(x=>x.id),
      correlationId,causationId:draft.causationId??null,
    });
    return mapCoordinationMessage(row);
  }

  async deliver(c: PoolClient, recipient: DurableCoordinationWorker, limit: number, afterMs: number): Promise<CoordinationDelivery[]> {
    if (TERMINAL.has(recipient.status)) {
      await c.query(
        `UPDATE sentient_coordination_deliveries
         SET state='dead_letter',dead_letter_reason='recipient_terminal'
         WHERE recipient_worker_id=$1 AND state IN('pending','delivered')`,[recipient.id]);
      return [];
    }
    const r = await c.query(
      `WITH due AS (
         SELECT d.message_id,d.recipient_worker_id
         FROM sentient_coordination_deliveries d
         JOIN sentient_coordination_messages m ON m.message_id=d.message_id
         WHERE d.recipient_worker_id=$1 AND d.state IN('pending','delivered') AND d.next_delivery_at<=now()
         ORDER BY m.created_at,m.message_id FOR UPDATE OF d SKIP LOCKED LIMIT $2
       ), delivered AS (
         UPDATE sentient_coordination_deliveries d SET
           state='delivered',delivery_attempts=d.delivery_attempts+1,
           first_delivered_at=coalesce(d.first_delivered_at,now()),last_delivered_at=now(),
           next_delivery_at=now()+$3*interval '1 millisecond'
         FROM due
         WHERE d.message_id=due.message_id AND d.recipient_worker_id=due.recipient_worker_id
         RETURNING d.*
       )
       SELECT m.*,d.state,d.delivery_attempts,d.first_delivered_at,d.last_delivered_at,d.acknowledged_at
       FROM delivered d JOIN sentient_coordination_messages m ON m.message_id=d.message_id
       ORDER BY m.created_at,m.message_id`,[recipient.id,limit,afterMs]);
    return r.rows.map(mapDelivery);
  }

  async acknowledge(c: PoolClient, recipient: DurableCoordinationWorker, messageId: string) {
    const r = await c.query(
      `SELECT d.*,m.task_id,m.tenant,m.repository_owner,m.repository_name
       FROM sentient_coordination_deliveries d
       JOIN sentient_coordination_messages m ON m.message_id=d.message_id
       WHERE d.message_id=$1 AND d.recipient_worker_id=$2 FOR UPDATE OF d`,[messageId,recipient.id]);
    if (r.rowCount !== 1) throw new CoordinationError("UNKNOWN_DELIVERY","message is not delivered to this worker");
    const d=r.rows[0]; assertBoundary(d,recipient);
    if (d.state==="dead_letter") throw new CoordinationError("DEAD_LETTER","delivery is dead letter");
    if (d.state==="acknowledged") return {acknowledged:true as const,alreadyAcknowledged:true};
    if (d.state!=="delivered") throw new CoordinationError("NOT_DELIVERED","message must be delivered before acknowledgement");
    await c.query(
      `UPDATE sentient_coordination_deliveries SET state='acknowledged',acknowledged_at=now()
       WHERE message_id=$1 AND recipient_worker_id=$2`,[messageId,recipient.id]);
    await this.audit(c,recipient.task_id,recipient.id,"COORDINATION_MESSAGE_ACKNOWLEDGED",{messageId});
    return {acknowledged:true as const,alreadyAcknowledged:false};
  }

  async audit(c: PoolClient, taskId:string, workerId:string, eventType:string, details:unknown) {
    await c.query(
      `INSERT INTO audit_events(task_id,event_type,actor,details) VALUES($1,$2,$3,$4::jsonb)`,
      [taskId,eventType,`worker:${workerId}`,JSON.stringify(details??{})]);
  }
}

function iso(v: unknown){return v instanceof Date?v.toISOString():new Date(String(v)).toISOString()}
function mapDelivery(row:any):CoordinationDelivery{
  return {message:mapCoordinationMessage(row),state:row.state,deliveryAttempts:Number(row.delivery_attempts),
    firstDeliveredAt:row.first_delivered_at?iso(row.first_delivered_at):undefined,
    lastDeliveredAt:row.last_delivered_at?iso(row.last_delivered_at):undefined,
    acknowledgedAt:row.acknowledged_at?iso(row.acknowledged_at):undefined};
}
