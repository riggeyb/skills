import type { Pool, PoolClient } from "pg";

export type GitHubLifecycleEvent = "installation" | "installation_repositories";

interface RepoPayload {
  id: number;
  name: string;
  owner: { login: string };
}

interface InstallationPayload {
  action: "created" | "suspended" | "unsuspended" | "deleted";
  installation: {
    id: number;
    account?: { login: string; type?: string };
    permissions?: Record<string, string>;
    created_at?: string;
  };
  repositories?: RepoPayload[];
}

interface InstallationRepositoriesPayload {
  action: "added" | "removed";
  installation: { id: number };
  repositories_added?: RepoPayload[];
  repositories_removed?: RepoPayload[];
}

export interface GitHubLifecycleStore {
  applyDelivery(
    eventName: GitHubLifecycleEvent,
    deliveryId: string,
    payload: unknown,
  ): Promise<boolean>;
}

export class PostgresGitHubLifecycleStore implements GitHubLifecycleStore {
  constructor(private readonly pool: Pool) {}

  async applyDelivery(
    eventName: GitHubLifecycleEvent,
    deliveryId: string,
    payload: unknown,
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const claimed = await client.query(
        `INSERT INTO github_deliveries(delivery_id) VALUES ($1)
         ON CONFLICT DO NOTHING RETURNING delivery_id`,
        [deliveryId],
      );
      if (claimed.rowCount !== 1) {
        await client.query("ROLLBACK");
        return false;
      }

      if (eventName === "installation") {
        await this.applyInstallation(client, payload as InstallationPayload);
      } else {
        await this.applyRepositories(client, payload as InstallationRepositoriesPayload);
      }

      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async applyInstallation(
    client: PoolClient,
    payload: InstallationPayload,
  ): Promise<void> {
    const id = payload.installation.id;
    const status =
      payload.action === "suspended"
        ? "suspended"
        : payload.action === "deleted"
          ? "deleted"
          : "active";

    await client.query(
      `INSERT INTO github_installations(
         installation_id, account_login, account_type, status, permissions, installed_at
       )
       VALUES ($1, $2, $3, $4, $5::jsonb, COALESCE($6::timestamptz, now()))
       ON CONFLICT (installation_id) DO UPDATE
       SET account_login = EXCLUDED.account_login,
           account_type = EXCLUDED.account_type,
           status = EXCLUDED.status,
           permissions = EXCLUDED.permissions,
           updated_at = now()`,
      [
        id,
        payload.installation.account?.login ?? null,
        payload.installation.account?.type ?? null,
        status,
        JSON.stringify(payload.installation.permissions ?? {}),
        payload.installation.created_at ?? null,
      ],
    );

    if (payload.action === "deleted") {
      await client.query(
        `UPDATE github_repositories
         SET active = false, updated_at = now()
         WHERE installation_id = $1`,
        [id],
      );
      return;
    }

    for (const repo of payload.repositories ?? []) {
      await this.upsertRepository(client, id, repo, true);
    }
  }

  private async applyRepositories(
    client: PoolClient,
    payload: InstallationRepositoriesPayload,
  ): Promise<void> {
    const installationId = payload.installation.id;

    for (const repo of payload.repositories_added ?? []) {
      await this.upsertRepository(client, installationId, repo, true);
    }
    for (const repo of payload.repositories_removed ?? []) {
      await this.upsertRepository(client, installationId, repo, false);
    }
  }

  private async upsertRepository(
    client: PoolClient,
    installationId: number,
    repo: RepoPayload,
    active: boolean,
  ): Promise<void> {
    await client.query(
      `INSERT INTO github_repositories(installation_id, repository_id, owner, name, active)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (installation_id, repository_id) DO UPDATE
       SET owner = EXCLUDED.owner,
           name = EXCLUDED.name,
           active = EXCLUDED.active,
           updated_at = now()`,
      [installationId, repo.id, repo.owner.login, repo.name, active],
    );
  }
}
