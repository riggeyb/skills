import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { PostgresProgressOutbox, ProgressOutboxSink } from "../src/progress-outbox.js";
import { SecretRedactor } from "../src/redaction.js";
import type { ProgressEvent } from "../src/types.js";

const databaseUrl = process.env.DATABASE_URL;

test("progress outbox deduplicates and persists only redacted progress", { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl! });
  try {
    const installationId = id();
    const deliveryId = randomUUID();
    const secret = "sentient-progress-secret";
    const task = await pool.query(
      `INSERT INTO tasks(delivery_id, objective, status, origin)
       VALUES ($1, 'progress test', 'running', $2::jsonb)
       RETURNING id`,
      [
        deliveryId,
        JSON.stringify({
          repository: { owner: "tenant-progress", repo: "repo" },
          issueNumber: 17,
          installationId,
          deliveryId,
          requestedBy: "tester",
        }),
      ],
    );
    const taskId = task.rows[0].id as string;
    const redactor = new SecretRedactor();
    redactor.register(secret);
    const outbox = new PostgresProgressOutbox(pool);
    const sink = new ProgressOutboxSink(outbox, redactor, "D_kwDO_sentient_test");

    const event: ProgressEvent = {
      task: {
        id: taskId,
        objective: "progress test",
        status: "running",
        origin: {
          repository: { owner: "tenant-progress", repo: "repo" },
          issueNumber: 17,
          installationId,
          deliveryId,
          requestedBy: "tester",
        },
        agents: [{ role: "backend", status: "running" }],
        messages: [],
        createdAt: new Date(Date.now() - 1_000).toISOString(),
        updatedAt: new Date().toISOString(),
      },
      headline: "Working",
      detail: `detail=${secret}`,
    };

    await sink.publish(event);
    await sink.publish(event);

    const rows = await pool.query(
      `SELECT destination, payload::text AS payload
       FROM progress_outbox WHERE task_id = $1 ORDER BY destination`,
      [taskId],
    );
    assert.equal(rows.rowCount, 2);
    assert.deepEqual(rows.rows.map((row) => row.destination), ["discussion_comment", "issue_comment"]);
    for (const row of rows.rows) {
      assert.equal(String(row.payload).includes(secret), false);
      assert.equal(String(row.payload).includes("[REDACTED]"), true);
    }

    const leased = await outbox.lease("reporter-test", 60_000);
    assert.ok(leased);
    assert.equal(leased.installationId, installationId);
    assert.deepEqual(leased.repository, { owner: "tenant-progress", repo: "repo" });
    await outbox.complete(leased.id, "reporter-test");
  } finally {
    await pool.end();
  }
});

function id(): number {
  return Number(`6${Date.now().toString().slice(-7)}${randomInt(10, 99)}`);
}
