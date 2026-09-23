import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PostgresGitHubLifecycleStore } from "../src/github-lifecycle.js";
import { PostgresCollaborationBus } from "../src/collaboration.js";
import { PostgresTaskGraphStore } from "../src/task-graph.js";
import { PostgresTaskStore } from "../src/postgres.js";

const databaseUrl = process.env.DATABASE_URL;

test("agent platform state is durable and lifecycle deliveries are idempotent", { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl! });
  try {
    const installationId = Number(`9${Date.now().toString().slice(-8)}`);
    const repositoryId = installationId + 1;
    const lifecycle = new PostgresGitHubLifecycleStore(pool);
    const installDelivery = randomUUID();

    const installationPayload = {
      action: "created" as const,
      installation: {
        id: installationId,
        account: { login: "sentient-test-org", type: "Organization" },
        permissions: { issues: "write", contents: "read" },
      },
      repositories: [
        {
          id: repositoryId,
          name: "test-repo",
          owner: { login: "sentient-test-org" },
        },
      ],
    };

    assert.equal(
      await lifecycle.applyDelivery("installation", installDelivery, installationPayload),
      true,
    );
    assert.equal(
      await lifecycle.applyDelivery("installation", installDelivery, installationPayload),
      false,
    );

    const installation = await pool.query(
      "SELECT status, account_login FROM github_installations WHERE installation_id = $1",
      [installationId],
    );
    assert.equal(installation.rows[0]?.status, "active");
    assert.equal(installation.rows[0]?.account_login, "sentient-test-org");

    const taskStore = new PostgresTaskStore(pool);
    const deliveryId = randomUUID();
    const task = await taskStore.create(
      "agent platform integration",
      {
        repository: { owner: "sentient-test-org", repo: "test-repo" },
        issueNumber: 1,
        installationId,
        deliveryId,
        requestedBy: "tester",
      },
      ["planner", "reviewer"],
    );

    const collaboration = new PostgresCollaborationBus(pool);
    const finding = await collaboration.publish({
      taskId: task.id,
      kind: "FINDING",
      fromAgent: "planner-1",
      toAgent: "reviewer-1",
      body: "API and tests can run independently.",
      details: { confidence: 0.9 },
    });
    assert.equal(finding.kind, "FINDING");

    const visible = await collaboration.list(task.id, "reviewer-1");
    assert.equal(visible.some((message) => message.id === finding.id), true);

    assert.equal(
      await collaboration.claimResource(task.id, "backend-1", "src/auth.ts", 30_000),
      true,
    );
    assert.equal(
      await collaboration.claimResource(task.id, "frontend-1", "src/auth.ts", 30_000),
      false,
    );
    assert.equal(
      await collaboration.releaseResource(task.id, "backend-1", "src/auth.ts"),
      true,
    );
    assert.equal(
      await collaboration.claimResource(task.id, "frontend-1", "src/auth.ts", 30_000),
      true,
    );

    const graph = new PostgresTaskGraphStore(pool);
    await graph.persist(task.id, {
      nodes: [
        { key: "api", role: "backend", objective: "Build API", priority: 5 },
        { key: "ui", role: "frontend", objective: "Build UI", priority: 4 },
        {
          key: "review",
          role: "reviewer",
          objective: "Integrate and review",
          dependsOn: ["api", "ui"],
        },
      ],
    });

    assert.deepEqual(
      (await graph.ready(task.id, 10)).map((node) => node.key),
      ["api", "ui"],
    );
    await graph.setStatus(task.id, "api", "completed", "api done");
    assert.deepEqual(
      (await graph.ready(task.id, 10)).map((node) => node.key),
      ["ui"],
    );
    await graph.setStatus(task.id, "ui", "completed", "ui done");
    assert.deepEqual(
      (await graph.ready(task.id, 10)).map((node) => node.key),
      ["review"],
    );
  } finally {
    await pool.end();
  }
});
