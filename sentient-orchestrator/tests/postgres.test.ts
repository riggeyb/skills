import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PostgresJobQueue, PostgresTaskStore } from "../src/postgres.js";

const databaseUrl = process.env.DATABASE_URL;

test("Postgres queue and task state survive adapter recreation", { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl! });
  try {
    const queueA = new PostgresJobQueue(pool);
    const key = `integration:${randomUUID()}`;
    const deliveryId = randomUUID();

    const enqueued = await queueA.enqueue(
      {
        type: "task.start",
        objective: "persist me",
        origin: {
          repository: { owner: "riggeyb", repo: "skills" },
          issueNumber: 54,
          installationId: 123,
          deliveryId,
          requestedBy: "tester",
        },
      },
      { idempotencyKey: key, maxAttempts: 2 },
    );
    assert.equal(enqueued.accepted, true);

    const queueB = new PostgresJobQueue(pool);
    const leased = await queueB.lease("integration-worker", 60_000);
    assert.equal(leased?.id, enqueued.jobId);
    await queueB.complete(enqueued.jobId, "integration-worker");

    const storeA = new PostgresTaskStore(pool);
    assert.equal(await storeA.claimDelivery(deliveryId), true);
    assert.equal(await storeA.claimDelivery(deliveryId), false);

    const task = await storeA.create(
      "persistent task",
      {
        repository: { owner: "riggeyb", repo: "skills" },
        issueNumber: 54,
        installationId: 123,
        deliveryId,
        requestedBy: "tester",
      },
      ["planner", "reviewer"],
    );
    await storeA.addMessage(task.id, "planner", "durable message");

    const storeB = new PostgresTaskStore(pool);
    const reloaded = await storeB.get(task.id);
    assert.equal(reloaded.objective, "persistent task");
    assert.equal(reloaded.messages[0]?.body, "durable message");
  } finally {
    await pool.end();
  }
});
