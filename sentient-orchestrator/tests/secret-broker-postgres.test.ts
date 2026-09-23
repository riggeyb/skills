import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { PostgresTenantAuthorizer } from "../src/authorization.js";
import { SecretRedactor } from "../src/redaction.js";
import {
  SecretBroker,
  type ProviderSecretGrant,
  type SecretProvider,
} from "../src/secrets.js";

const databaseUrl = process.env.DATABASE_URL;

test("secret broker stores references only and revokes provider grants", { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl! });
  try {
    const installationId = id();
    await pool.query(
      `INSERT INTO github_installations(installation_id, account_login, status)
       VALUES ($1, 'secret-tenant', 'active')`,
      [installationId],
    );
    await pool.query(
      `INSERT INTO github_repositories(installation_id, repository_id, owner, name, active)
       VALUES ($1, $2, 'secret-tenant', 'repo', true)`,
      [installationId, installationId * 10 + 1],
    );

    const auth = new PostgresTenantAuthorizer(pool);
    const principal = {
      installationId,
      principalId: "secret-user",
      principalType: "github_user" as const,
    };
    await auth.upsertPrincipal(principal);
    await auth.bindRole(installationId, principal.principalId, "developer");

    const redactor = new SecretRedactor();
    const provider = new FakeSecretProvider();
    const broker = new SecretBroker(pool, auth, provider, redactor);
    const lease = await broker.issue({
      principal,
      scope: {
        installationId,
        repository: { owner: "secret-tenant", repo: "repo" },
      },
      secretName: "GITHUB_TOKEN",
      purposes: ["sandbox"],
      ttlMs: 60_000,
    });

    assert.equal(lease.value, FakeSecretProvider.SECRET);
    const durable = await pool.query(`SELECT * FROM secret_leases WHERE id = $1`, [lease.id]);
    assert.equal(durable.rowCount, 1);
    assert.equal(JSON.stringify(durable.rows[0]).includes(FakeSecretProvider.SECRET), false);
    assert.equal(
      redactor.redact(Buffer.from(FakeSecretProvider.SECRET).toString("base64")),
      "[REDACTED]",
    );

    await broker.revoke(principal, lease.id);
    assert.deepEqual(provider.revoked, ["fake-ref"]);
    const revoked = await pool.query(`SELECT revoked_at FROM secret_leases WHERE id = $1`, [lease.id]);
    assert.ok(revoked.rows[0].revoked_at);
  } finally {
    await pool.end();
  }
});

class FakeSecretProvider implements SecretProvider {
  static readonly SECRET = "fake-secret-BBB-BBB-BBB";
  readonly revoked: string[] = [];

  async issue(input: {
    installationId: number;
    principalId: string;
    secretName: string;
    purposes: string[];
    ttlMs: number;
    repository?: { owner: string; repo: string };
  }): Promise<ProviderSecretGrant> {
    return {
      provider: "fake",
      reference: "fake-ref",
      value: FakeSecretProvider.SECRET,
      expiresAt: new Date(Date.now() + input.ttlMs - 100).toISOString(),
    };
  }

  async revoke(reference: string): Promise<void> {
    this.revoked.push(reference);
  }
}

function id(): number {
  return Number(`5${Date.now().toString().slice(-7)}${randomInt(10, 99)}`);
}
