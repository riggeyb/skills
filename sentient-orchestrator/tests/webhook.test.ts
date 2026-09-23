import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { InMemoryJobQueue } from "../src/queue.js";
import { extractSentientCommand, handleGitHubWebhook, verifyGitHubSignature } from "../src/webhook.js";

test("extracts @sentient command", () => {
  assert.equal(extractSentientCommand("@sentient build this feature"), "build this feature");
  assert.equal(extractSentientCommand("hello"), null);
});

test("verifies GitHub SHA-256 signature", () => {
  const body = JSON.stringify({ hello: "world" });
  const secret = "test-secret";
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  assert.equal(verifyGitHubSignature(body, signature, secret), true);
  assert.equal(verifyGitHubSignature(body, "sha256=bad", secret), false);
});

test("signed @sentient webhook is durably enqueued and deduplicated", async () => {
  const secret = "test-secret";
  const deliveryId = "delivery-webhook-1";
  const body = JSON.stringify({
    action: "created",
    installation: { id: 123 },
    repository: { name: "skills", owner: { login: "riggeyb" } },
    issue: { number: 54 },
    comment: { body: "@sentient implement durable queue", user: { login: "tester" } },
  });
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  const queue = new InMemoryJobQueue();

  const first = await handleGitHubWebhook({
    eventName: "issue_comment",
    deliveryId,
    rawBody: body,
    signature,
    webhookSecret: secret,
    queue,
  });
  const second = await handleGitHubWebhook({
    eventName: "issue_comment",
    deliveryId,
    rawBody: body,
    signature,
    webhookSecret: secret,
    queue,
  });

  assert.equal(first.accepted, true);
  assert.equal(second.accepted, false);
  assert.equal(second.reason, "duplicate_delivery");
  assert.equal(second.jobId, first.jobId);

  const leased = await queue.lease("test-worker", 60_000);
  assert.equal(leased?.payload.objective, "implement durable queue");
  assert.equal(leased?.payload.origin.issueNumber, 54);
});
