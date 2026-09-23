import type { Pool } from "pg";
import type {
  AuthenticatedPrincipal,
  AuthorizationService,
  TenantScope,
} from "./authorization.js";
import { SecretRedactor } from "./redaction.js";

export interface SecretGrantRequest {
  principal: AuthenticatedPrincipal;
  scope: TenantScope;
  secretName: string;
  purposes: string[];
  ttlMs: number;
}

export interface ProviderSecretGrant {
  provider: string;
  reference: string;
  value: string;
  expiresAt: string;
}

export interface SecretProvider {
  issue(input: {
    installationId: number;
    principalId: string;
    secretName: string;
    purposes: string[];
    ttlMs: number;
    repository?: { owner: string; repo: string };
  }): Promise<ProviderSecretGrant>;
  revoke(reference: string): Promise<void>;
}

export interface SecretLease {
  id: string;
  name: string;
  value: string;
  expiresAt: string;
}

export class SecretBroker {
  private readonly liveValues = new Map<string, string>();

  constructor(
    private readonly pool: Pool,
    private readonly authorization: AuthorizationService,
    private readonly provider: SecretProvider,
    private readonly redactor: SecretRedactor,
    private readonly maxTtlMs = 60 * 60_000,
  ) {}

  async issue(request: SecretGrantRequest): Promise<SecretLease> {
    validateGrantRequest(request, this.maxTtlMs);
    await this.authorization.require({
      principal: request.principal,
      scope: request.scope,
      action: "secrets.use",
      metadata: { secretName: request.secretName, purposes: request.purposes },
    });

    const grant = await this.provider.issue({
      installationId: request.scope.installationId,
      principalId: request.principal.principalId,
      secretName: request.secretName,
      purposes: request.purposes,
      ttlMs: request.ttlMs,
      repository: request.scope.repository,
    });
    validateProviderGrant(grant, request.ttlMs);

    this.redactor.register(grant.value);
    const result = await this.pool.query(
      `INSERT INTO secret_leases(
         installation_id, principal_id, provider, secret_name,
         external_ref, scope, expires_at
       )
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       RETURNING id`,
      [
        request.scope.installationId,
        request.principal.principalId,
        grant.provider,
        request.secretName,
        grant.reference,
        JSON.stringify({
          repository: request.scope.repository,
          purposes: request.purposes,
        }),
        grant.expiresAt,
      ],
    );

    const id = result.rows[0].id as string;
    this.liveValues.set(id, grant.value);
    return {
      id,
      name: request.secretName,
      value: grant.value,
      expiresAt: grant.expiresAt,
    };
  }

  async revoke(
    principal: AuthenticatedPrincipal,
    leaseId: string,
  ): Promise<void> {
    const result = await this.pool.query(
      `SELECT installation_id, principal_id, external_ref, scope, revoked_at
       FROM secret_leases
       WHERE id = $1`,
      [leaseId],
    );
    if (result.rowCount !== 1) throw new Error(`Unknown secret lease ${leaseId}`);
    const row = result.rows[0];
    if (Number(row.installation_id) !== principal.installationId) {
      throw new Error("Secret lease is outside principal tenant");
    }

    const scope: TenantScope = {
      installationId: principal.installationId,
      repository: row.scope?.repository ?? undefined,
    };
    await this.authorization.require({
      principal,
      scope,
      action: row.principal_id === principal.principalId ? "secrets.use" : "secrets.manage",
      metadata: { leaseId },
    });

    if (row.revoked_at) return;
    await this.provider.revoke(row.external_ref);
    await this.pool.query(
      `UPDATE secret_leases
       SET revoked_at = now(), updated_at = now()
       WHERE id = $1 AND revoked_at IS NULL`,
      [leaseId],
    );

    const value = this.liveValues.get(leaseId);
    if (value) {
      this.redactor.unregister(value);
      this.liveValues.delete(leaseId);
    }
  }
}

export class RemoteSecretProvider implements SecretProvider {
  constructor(
    private readonly name: string,
    private readonly baseUrl: string,
    private readonly serviceToken: string,
    private readonly timeoutMs = 15_000,
  ) {}

  async issue(input: {
    installationId: number;
    principalId: string;
    secretName: string;
    purposes: string[];
    ttlMs: number;
    repository?: { owner: string; repo: string };
  }): Promise<ProviderSecretGrant> {
    const response = await this.request("/v1/grants", {
      method: "POST",
      body: JSON.stringify(input),
    });
    const body = (await response.json()) as {
      reference?: string;
      value?: string;
      expiresAt?: string;
    };
    if (!body.reference || !body.value || !body.expiresAt) {
      throw new Error("Secret provider returned an invalid grant");
    }
    return {
      provider: this.name,
      reference: body.reference,
      value: body.value,
      expiresAt: body.expiresAt,
    };
  }

  async revoke(reference: string): Promise<void> {
    if (!reference) throw new Error("Secret grant reference is required");
    await this.request(`/v1/grants/${encodeURIComponent(reference)}`, {
      method: "DELETE",
    });
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.serviceToken}`,
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });
      if (!response.ok) {
        throw new Error(`Secret provider ${path} failed: ${response.status}`);
      }
      return response;
    } finally {
      clearTimeout(timer);
    }
  }
}

function validateGrantRequest(request: SecretGrantRequest, maxTtlMs: number): void {
  if (!request.secretName.trim()) throw new Error("secretName cannot be empty");
  if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(request.secretName)) {
    throw new Error("secretName contains invalid characters");
  }
  if (
    !Number.isSafeInteger(request.ttlMs) ||
    request.ttlMs < 1_000 ||
    request.ttlMs > maxTtlMs
  ) {
    throw new Error(`ttlMs must be between 1000 and ${maxTtlMs}`);
  }
  if (
    !Array.isArray(request.purposes) ||
    request.purposes.length === 0 ||
    request.purposes.length > 16 ||
    request.purposes.some((purpose) => !purpose.trim() || purpose.length > 128)
  ) {
    throw new Error("purposes must contain 1-16 non-empty values");
  }
}

function validateProviderGrant(grant: ProviderSecretGrant, requestedTtlMs: number): void {
  if (!grant.provider || !grant.reference || !grant.value) {
    throw new Error("Secret provider grant is incomplete");
  }
  const expiresAt = Date.parse(grant.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new Error("Secret provider grant is expired");
  }
  if (expiresAt > Date.now() + requestedTtlMs + 60_000) {
    throw new Error("Secret provider grant exceeds requested TTL");
  }
}
