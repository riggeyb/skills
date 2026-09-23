import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import {
  MetricRegistry,
  PostgresOperationalEvents,
  PostgresServiceHeartbeat,
  StructuredLogger,
} from "../src/observability.js";
import { SecretRedactor } from "../src/redaction.js";

const databaseUrl = process.env.DATABASE_URL;

test("structured telemetry redacts secrets and renders stable metrics", () => {
  const secret = "sentient-observability-secret";
  const redactor = new SecretRedactor();
  redactor.register(secret);
  const lines: string[] = [];
  const logger = new StructuredLogger(redactor, (line) => lines.push(line));
  logger.error({
    service: "worker",
    event: "task.failed",
    correlationId: "delivery-123",
    details: { token: secret },
    error: new Error(`failure ${secret}`),
  });
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.includes(secret), false);
  assert.equal(lines[0]!.includes("[REDACTED]"), true);
  assert.equal(JSON.parse(lines[0]!).correlationId, "delivery-123");

  const metrics = new MetricRegistry();
  metrics.inc("sentient_jobs_total", { status: "completed" }, 2);
  metrics.set("sentient_queue_depth", 3);
  const rendered = metrics.renderPrometheus();
  assert.match(rendered, /sentient_jobs_total\{status="completed"\} 2/);
  assert.match(rendered, /sentient_queue_depth 3/);
});

test("correlation propagates from GitHub delivery to task-linked records and heartbeats persist", { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl! });
  try {
    const installationId = uniqueInstallationId();
    const deliveryId = `corr-${randomUUID()}`;
    await pool.query(
      `INSERT INTO github_installations(installation_id, account_login, status)
       VALUES ($1, $2, 'active')`,
      [installationId, `corr-${installationId}`],
    );
    await pool.query(
      `INSERT INTO github_repositories(installation_id, repository_id, owner, name, active)
       VALUES ($1, $2, 'corr-owner', 'corr-repo', true)`,
      [installationId, installationId * 10 + 1],
    );

    const task = await pool.query(
      `INSERT INTO tasks(delivery_id, objective, status, origin)
       VALUES ($1, 'correlation test', 'running', $2::jsonb)
       RETURNING id, correlation_id`,
      [
        deliveryId,
        JSON.stringify({
          repository: { owner: "corr-owner", repo: "corr-repo" },
          issueNumber: 1,
          installationId,
          deliveryId,
          requestedBy: "tester",
        }),
      ],
    );
    const taskId = task.rows[0].id as string;
    assert.equal(task.rows[0].correlation_id, deliveryId);

    const model = await pool.query(
      `INSERT INTO model_calls(task_id, agent_role, provider, model, capability, status)
       VALUES ($1, 'backend', 'fake', 'fake-model', 'coding.deep', 'succeeded')
       RETURNING correlation_id`,
      [taskId],
    );
    assert.equal(model.rows[0].correlation_id, deliveryId);

    const action = await pool.query(
      `INSERT INTO action_runs(task_id, installation_id, repository_owner, repository_name, workflow_name, status)
       VALUES ($1, $2, 'corr-owner', 'corr-repo', 'verify', 'queued')
       RETTRNING correlation_id`,
      [taskId, installationId],
    );
    assert.equal(action.rows[0].correlation_id, deliveryId);

    const heartbeat = new PostgresServiceHeartbeat(pool, "worker", `worker-${installationId}`);
    await heartbeat.beat("ready", { taskId });
    const heartbeatRow = await pool.query(
      `SELECT status FROM service_heartbeats WHERE service = 'worker' AND instance_id = $1`,
      [`worker-${installationId}`],
    );
    assert.equal(heartbeatRow.rows[0].status, "ready");

    const secret = "sentient-operational-secret";
    const redactor = new SecretRedactor();
    redactor.register(secret);
    const events = new PostgresOperationalEvents(pool, redactor);
    const eventKey = `operational-${deliveryId}`;
    await events.record({
      eventKey,
      severity: "error",
      service: "worker",
      eventName: "task.failed",
      installationId,
      repository: { owner: "corr-owner", repo: "corr-repo" },
      taskId,
      correlationId: deliveryId,
      details: { message: secret },
    });
    await events.record({
      eventKey,
      severity: "error",
      service: "worker",
      eventName: "task.failed",
      installationId,
      repository: { owner: "corr-owner", repo: "corr-repo" },
      taskId,
      correlationId: deliveryId,
      details: { message: secret },
    });
    const opRows = await pool.query(
      `SELECT correlation_id, details::text AS details
       FROM operational_events WHERE event_key = $1`,
      [eventKey],
    );
    assert.equal(opRows.rowCount, 1);
    assert.equal(opRows.rows[0].correlation_id, deliveryId);
    assert.equal(String(opRows.rows[0].details).includes(secret), false);
    assert.equal(String(opRows.rows[0].details).includes("[REDACTED]"), true);
  } finally {
    await pool.end();
  }
});

function uniqueInstallationId(): number {
  const timePart = Number(Date.now().toString().slice(-7));
  return Number(`3${timePart}${randomInt(10, 99)}`);
}
