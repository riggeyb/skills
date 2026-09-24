import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  DIRECT_COORDINATION_RULE,
  type CoordinationAck, type CoordinationActor, type CoordinationDelivery,
  type CoordinationDraft, type CoordinationInboxOptions, type SentientCoordinationChannel,
  type SentientCoordinationMessage,
} from "./sentient-coordination-types.js";
import {
  CoordinationError, assertCoordinationType, assertJsonPayload, assertUuid,
  nonEmpty, rejectPrivateReasoning,
} from "./sentient-coordination-validation.js";
import { SentientCoordinationStore } from "./sentient-coordination-store.js";

const LEAD_ONLY = new Set(["DIRECTIVE","DECISION"]);

export class SentientCoordinationService {
  private readonly store: SentientCoordinationStore;
  constructor(db: Pool) { this.store = new SentientCoordinationStore(db); }

  channel(actor: CoordinationActor): SentientCoordinationChannel {
    return {
      behavioralRule: DIRECT_COORDINATION_RULE,
      inbox: options => this.inbox(actor,options),
      send: draft => this.send(actor,draft),
      ack: messageId => this.ack(actor,messageId),
    };
  }

  async send(actor: CoordinationActor, draft: CoordinationDraft): Promise<SentientCoordinationMessage> {
    assertCoordinationType(draft.type);
    assertJsonPayload(draft.payload);
    rejectPrivateReasoning(draft.payload);
    const messageId=draft.messageId??randomUUID(); assertUuid(messageId,"messageId");
    if (draft.causationId) assertUuid(draft.causationId,"causationId");
    if (draft.target.kind==="worker") assertUuid(draft.target.workerId,"recipientWorkerId");

    const c=await this.store.db.connect();
    try {
      await c.query("BEGIN");
      const sender=await this.store.actor(c,actor);
      if (LEAD_ONLY.has(draft.type)) {
        if (!draft.leadershipEpoch || draft.leadershipEpoch<=0)
          throw new CoordinationError("LEADERSHIP_EPOCH_REQUIRED","Lead message requires leadership epoch");
        await this.store.activeLead(c,sender,draft.leadershipEpoch);
      } else if (draft.leadershipEpoch!==undefined) {
        throw new CoordinationError("UNEXPECTED_LEADERSHIP_EPOCH","leadership epoch is only valid for Lead-fenced message types");
      }
      if (draft.causationId) await this.store.causal(c,sender,draft.causationId);
      const recipients=await this.store.recipients(c,sender,draft);
      const correlationId=draft.correlationId??sender.correlation_id; nonEmpty(correlationId,"correlationId");
      const message=await this.store.persist(c,sender,draft,messageId,correlationId,recipients);
      await c.query("COMMIT");
      return message;
    } catch(error) {
      await c.query("ROLLBACK"); throw error;
    } finally { c.release(); }
  }

  async inbox(actor: CoordinationActor, options: CoordinationInboxOptions={}): Promise<CoordinationDelivery[]> {
    const limit=options.limit??50, afterMs=options.redeliveryAfterMs??30_000;
    const requiredMessageId=options.requiredMessageId;
    if (!Number.isInteger(limit)||limit<=0||limit>500)
      throw new CoordinationError("INVALID_INBOX_LIMIT","limit must be between 1 and 500");
    if (!Number.isFinite(afterMs)||afterMs<0)
      throw new CoordinationError("INVALID_REDELIVERY_WINDOW","redeliveryAfterMs must be non-negative");
    if (requiredMessageId) assertUuid(requiredMessageId,"requiredMessageId");
    const c=await this.store.db.connect();
    try {
      await c.query("BEGIN");
      const recipient=await this.store.actor(c,actor);
      const messages=await this.store.deliver(c,recipient,limit,afterMs,requiredMessageId);
      await c.query("COMMIT");
      return messages;
    } catch(error) {
      await c.query("ROLLBACK"); throw error;
    } finally { c.release(); }
  }

  async ack(actor: CoordinationActor, messageId:string):Promise<CoordinationAck>{
    assertUuid(messageId,"messageId");
    const c=await this.store.db.connect();
    try {
      await c.query("BEGIN");
      const recipient=await this.store.actor(c,actor);
      const result=await this.store.acknowledge(c,recipient,messageId);
      await c.query("COMMIT");
      return result;
    } catch(error) {
      await c.query("ROLLBACK"); throw error;
    } finally { c.release(); }
  }
}
