import type { ModelExecutionRequest, ModelExecutionResponse } from "./model-execution.js";
import type { SentientCoordinationService } from "./sentient-coordination.js";
import type { ModelCoordinationAction, SentientCoordinationChannel } from "./sentient-coordination-types.js";

export async function prepareModelCoordination(
  service: SentientCoordinationService | undefined,
  request: ModelExecutionRequest,
): Promise<{ request: ModelExecutionRequest; channel?: SentientCoordinationChannel }> {
  if (!service) return { request };
  const channel = service.channel({
    workerId: request.identity.workerId,
    taskId: request.identity.taskId,
    tenant: request.identity.tenant,
    repository: request.identity.repository,
    attemptCount: request.identity.attemptCount,
  });
  const pending = await channel.inbox();
  return {
    channel,
    request: {
      ...request,
      coordination: {
        behavioralRule: channel.behavioralRule,
        pending,
      },
    },
  };
}

export async function applyModelCoordinationActions(
  channel: SentientCoordinationChannel | undefined,
  response: ModelExecutionResponse,
): Promise<void> {
  const actions = response.coordinationActions;
  if (actions === undefined) return;
  if (!Array.isArray(actions)) throw new Error("invalid_coordination_actions");
  if (!channel && actions.length) throw new Error("coordination_unavailable");
  for (const raw of actions as unknown[]) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("invalid_coordination_action");
    }
    const action = raw as Partial<ModelCoordinationAction> & Record<string, unknown>;
    if (action.kind === "ack") {
      if (typeof action.messageId !== "string") throw new Error("invalid_coordination_ack");
      await channel!.ack(action.messageId);
      continue;
    }
    if (action.kind === "send") {
      if (!action.draft || typeof action.draft !== "object" || Array.isArray(action.draft)) {
        throw new Error("invalid_coordination_send");
      }
      await channel!.send(action.draft);
      continue;
    }
    throw new Error("invalid_coordination_action_kind");
  }
}
