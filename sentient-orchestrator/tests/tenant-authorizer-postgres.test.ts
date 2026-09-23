import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { PostgresTenantAuthorizer } from "../src/authorization.js";

const databaseUrl = process.env.DATABASE_URL;

test("tenant authorizer isolates installations and provisions reporter", { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl! });
  try {
    const a = id();
    const b = a + 1;
    await pool.query(
      `INSERT INTO github_installations(installation_id, account_login, status)
       VALUES ($1, 'tenant-a', 'active'), ($2, 'tenant-b', 'active')`,
      [a, b],
    );
    await pool.query(
      `INSERT INTO github_repositories(installation_id, repository_id, owner, name, active)
       VALUES ($1, $2, 'tenant-a', 'repo-a', true), ($3, $4, 'tenant-b', 'repo-b', true)`,
      [a, a * 10 + 1, b, b * 10 + 1],
    );

    const reporter = await pool.query(
      `SELECT p.active, b.role FROM tenant_principals p
       JOIN tenant_role_bindings b USING (installation_id, principal_id)
       WHERE p.installation_id = $1 AND p.principal_id = 'sentient-reporter'`,
      [a],
    );
    assert.deepEqual(
      { active: reporter.rows[0].active, role: reporter.rows[0].role },
      { active: true, role: "operator" },
    );

    const auth = new PostgresTenantAuthorizer(pool);
    const principal = { installationId: a, principalId: "user-1", principalType: "github_user" as const };
    await auth.upsertPrincipal(principal);
    await auth.bindRole(a, principal.principalId, "developer");

    const own = await auth.authorize({
      principal,
      scope: { installationId: a, repository: { owner: "tenant-a", repo: "repo-a" } },
      action: "actions.run",
    });
    assert.equal(own.allowed, true);

    const cross = await auth.authorize({
      principal,
      scope: { installationId: b, repository: { owner: "tenant-b", repo: "repo-b" } },
      action: "task.read",
    });
    assert.equal(cross.allowed, false);
    assert.equal(cross.reason, "principal_tenant_mismatch");

    const missing = await auth.authorize({
      principal,
      scope: { installationId: a, repository: { owner: "tenant-a", repo: "missing" } },
      action: "repository.read",
    });
    assert.equal(missing.allowed, false);
    assert.equal(missing.reason, "repository_outside_tenant");

    await pool.query(`UPDATE github_installations SET status = 'suspended' WHERE installation_id = $1`, [a]);
    const suspended = await pool.query(
      `SELECT active FROM tenant_principals WHERE installation_id = $1 AND principal_id = 'sentient-reporter'`,
      [a],
    );
    assert.equal(suspended.rows[0].active, false);
  } finally {
    await pool.end();
  }
});

function id(): number {
  return Number(`7${Date.now().toString().slice(-7)}${randomInt(10, 99)}`);
}
