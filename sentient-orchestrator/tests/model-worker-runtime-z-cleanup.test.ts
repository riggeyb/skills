import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";

const url = process.env.DATABASE_URL;

test("model runtime integration fixtures are isolated from later legacy control-plane tests", { skip: !url }, async () => {
  const db = new Pool({ connectionString: url! });
  try {
    const before = await db.query(
      `SELECT count(*)::int AS count
       FROM tasks
       WHERE origin->>'requestedBy' IN ('model-worker-runtime-test','automatic-model-worker-test')`,
    );
    assert.ok(Number(before.rows[0].count) > 0);

    await db.query(
      `DELETE FROM tasks
       WHERE origin->>'requestedBy' IN ('model-worker-runtime-test','automatic-model-worker-test')`,
    );

    const after = await db.query(
      `SELECT count()::int AS count
       FROM tasks
       WHERE origin->>'requestedBy' IN ('model-worker-runtime-test','automatic-model-worker-test')`,
    );
    assert.equal(Number(after.rows[0].count), 0);
  } finally {
    await db.end();
  }
});
