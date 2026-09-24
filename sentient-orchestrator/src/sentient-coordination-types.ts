import type { JsonValue, MessageType, ProtocolMessage } from "./worker-protocol.js";

export const DIRECT_COORDINATION_RULE =
  "Never ask the human operator to relay a coordination message when an authorized Sentient coordination channel is available. Send it directly; escalate to the human only for decisions requiring human authority." as const;

export const COORDINATION_MESSAGE_TYPES = [
  "QUESTION","ANSWER","FINDING","PROPOSAL","DECISION","DEPENDENCY","BLOCKER",
  "HANDOFF","STATUS","DONE","DIRECTIVE","ESCALATION",
] as const satisfies readonly MessageType[];

export type CoordinationMessageType = (typeof COORDINATION_MESSAGE_TYPES)[number];
export type CoordinationTarget =
  | { kind: "worker"; workerId: string }
  | { kind: "lead" }
  | { kind: "task" };

export interface CoordinationActor {
  workerId: string;
  taskId: string;
  tenant: string;
  repository: { owner: string; repo: string };
  attemptCount?: number;
}

export interface CoordinationDraft {
  messageId?: string;
  target: CoordinationTarget;
  type: CoordinationMessageType;
  correlationId?: string;
  causationId?: string;
  payload: JsonValue;
  leadershipEpoch?: number;
}

export interface SentientCoordinationMessage extends ProtocolMessage<JsonValue> {
  type: CoordinationMessageType;
  targetKind: CoordinationTarget["kind"];
  recipientWorkerId?: string;
  leadershipEpoch?: number;
}

export interface CoordinationDelivery {
  message: SentientCoordinationMessage;
  state: "pending"|"delivered"|"acknowledged"|"dead_letter";
  deliveryAttempts: number;
  firstDeliveredAt?: string;
  lastDeliveredAt?: string;
  acknowledgedAt?: string;
}

export interface CoordinationInboxOptions {
  limit?: number;
  redeliveryAfterMs?: number;
}

export interface CoordinationAck {
  acknowledged: true;
  alreadyAcknowledged: boolean;
}

export interface SentientCoordinationChannel {
  readonly behavioralRule: typeof DIRECT_COORDINATION_RULE;
  inbox(options?: CoordinationInboxOptions): Promise<CoordinationDelivery[]>;
  send(draft: CoordinationDraft): Promise<SentientCoordinationMessage>;
  ack(messageId: string): Promise<CoordinationAck>;
}

export type ModelCoordinationAction =
  | { kind: "send"; draft: CoordinationDraft }
  | { kind: "ack"; messageId: string };

export interface ModelCoordinationInput {
  behavioralRule: typeof DIRECT_COORDINATION_RULE;
  pending: CoordinationDelivery[];
}
