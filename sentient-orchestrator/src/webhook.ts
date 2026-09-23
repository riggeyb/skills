import { createHmac, timingSafeEqual } from "node:crypto";
import type { Orchestrator } from "./orchestrator.js";

interface IssueCommentPayload {
  action: string;
  installation?: { id: number };
  repository: {
    name: string;
    owner: { login: string };
  };
  issue: { number: number };
  comment: {
    body: string;
    user: { login: string };
  };
}

export function verifyGitHubSignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function handleGitHubWebhook(input: {
  eventName: string;
  deliveryId: string;
  rawBody: string;
  signature: string;
  webhookSecret: string;
  orchestrator: Orchestrator;
}): Promise<{ accepted: boolean; reason?: string }> {
  if (!verifyGitHubSignature(input.rawBody, input.signature, input.webhookSecret)) {
    throw new Error("Invalid GitHub webhook signature");
  }

  if (input.eventName !== "issue_comment") {
    return { accepted: false, reason: "unsupported_event" };
  }

  const payload = JSON.parse(input.rawBody) as IssueCommentPayload;
  if (payload.action !== "created") return { accepted: false, reason: "unsupported_action" };

  const objective = extractSentientCommand(payload.comment.body);
  if (!objective) return { accepted: false, reason: "no_sentient_command" };
  if (!payload.installation?.id) throw new Error("Webhook is missing GitHub App installation id");

  if (!input.deliveryId) throw new Error("Webhook is missing X-GitHub-Delivery");

  void input.orchestrator
    .start(objective, {
      repository: {
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
      },
      issueNumber: payload.issue.number,
      installationId: payload.installation.id,
      deliveryId: input.deliveryId,
      requestedBy: payload.comment.user.login,
    })
    .catch((error) => {
      console.error(`[sentient] task failed for delivery ${input.deliveryId}`, error);
    });

  return { accepted: true };
}

export function extractSentientCommand(body: string): string | null {
  const match = body.match(/@sentient\b[\s,:-]*(.+)/is);
  const objective = match?.[1]?.trim();
  return objective ? objective : null;
}
