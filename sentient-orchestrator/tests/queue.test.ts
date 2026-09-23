import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryJobQueue } from "../src/queue.js";

const payload = {
  type: "task.start" as const,
  objective: "test objective",
  origin: {
    repository: { owner: "riggeyb", repo: "skills" },
    issueNumber: 1,
    installationId: 123,
    deliveryId: "delivery",
    requestedBy: "tester",
  },
};

test("queue deduplicates idempotency keys", async () => {
  const queue = new InMemoryJobQueue();
  const first = await queue.enqueue(payload, { idempotencyKey: "same" });
  const second = await queue.enqueue(payload, { idempotencyKey: "same" });

  assert.equal(first.accepted, true);
  assert.equal(second.accepted, false);
  assert.equal(second.jobId, first.jobId);
});

test("expired leases can be reclaimed and eventually dead-letter", async () => {
  const queue = new InMemoryJobQueue();
  const enqueued = await queue.enqueue(payload, {
    idempotencyKey: "retry",
    maxAttempts: 2,
  });

  const first = await queue.lease("worker-a", 0);
  assert.equal(first?.id, enqueued.jobId);
  await new Promise((resolve) => setTimeout(resolve, 1));

  const second = await queue.lease("worker-b", 1000);
  assert.equal(second?.id, enqueued.jobId);
  const result = await queue.fail(enqueued.jobId, "worker-b", "boom");
  assert.equal(result.deadLettered, true);
});
