import { createHmac, timingSafeEqual } from "node:crypto";
import type { GitHubLifecycleStore } from "./github-lifecycle.js";
import type { JobQueue } from "./ports.js";

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

export function verifyGitHubSignature(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
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
  queue: JobQueue;
  lifecycle?: GitHubLifecycleStore;
}): Promise<{ accepted: boolean; reason?: string; jobId?: string }> {
  if (!verifyGitHubSignature(input.rawBody, input.signature, input.webhookSecret)) {
    throw new Error("Invalid GitHub webhook signature");
  }
  if (!input.deliveryId) throw new Error("Webhook is missing X-GitHub-Delivery");

  if (
    input.eventName === "installation" ||
    input.eventName === "installation_repositories"
  ) {
    if (!input.lifecycle) {
      return { accepted: false, reason: "lifecycle_store_unavailable" };
    }
    const accepted = await input.lifecycle.applyDelivery(
      input.eventName,
      input.deliveryId,
      JSON.parse(input.rawBody),
    );
    return {
      accepted,
      reason: accepted ? undefined : "duplicate_delivery",
    };
  }

  if (input.eventName !== "issue_comment") {
    return { accepted: false, reason: "unsupported_event" };
  }

  const payload = JSON.parse(input.rawBody) as IssueCommentPayload;
  if (payload.action !== "created") {
    return { accepted: false, reason: "unsupported_action" };
  }

  const objective = extractSentientCommand(payload.comment.body);
  if (!objective) return { accepted: false, reason: "no_sentient_command" };
  if (!payload.installation?.id) {
    throw new Error("Webhook is missing GitHub App installation id");
  }

  const enqueued = await input.queue.enqueue(
    {
      type: "task.start",
      objective,
      origin: {
        repository: {
          owner: payload.repository.owner.login,
          repo: payload.repository.name,
        },
        issueNumber: payload.issue.number,
        installationId: payload.installation.id,
        deliveryId: input.deliveryId,
        requestedBy: payload.comment.user.login,
      },
    },
    {
      idempotencyKey: `github:${input.deliveryId}`,
      priority: 0,
      maxAttempts: 5,
    },
  );

  return {
    accepted: enqueued.accepted,
    reason: enqueued.accepted ? undefined : "duplicate_delivery",
    jobId: enqueued.jobId,
  };
}

export function extractSentientCommand(body: string): string | null {
  const match = body.match(/@sentient\b[\s,:-]*(.+)/is);
  const objective = match?.[1]?.trim();
  return objective ? objective : null;
}
