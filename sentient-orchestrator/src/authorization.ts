import type { Pool } from "pg";

export type TenantRole = "viewer" | "developer" | "operator" | "admin";
export type TenantAction =
  | "task.read"
  | "task.write"
  | "repository.read"
  | "repository.write"
  | "actions.run"
  | "progress.publish"
  | "secrets.use"
  | "secrets.manage"
  | "tenant.manage";

export interface AuthenticatedPrincipal {
  installationId: number;
  principalId: string;
  principalType: "github_user" | "service" | "system";
}

export interface TenantScope {
  installationId: number;
  repository?: { owner: string; repo: string };
}

export interface AuthorizationRequest {
  principal: AuthenticatedPrincipal;
  scope: TenantScope;
  action: TenantAction;
  metadata?: Record<string, unknown>;
}

export interface AuthorizationDecision {
  allowed: boolean;
  reason: string;
  roles: TenantRole[];
}

const ROLE_LEVEL: Record<TenantRole, number> = {
  viewer: 1,
  developer: 2,
  operator: 3,
  admin: 4,
};

const ACTION_LEVEL: Record<TenantAction, number> = {
  "task.read": 1,
  "repository.read": 1,
  "task.write": 2,
  "repository.write": 2,
  "actions.run": 2,
  "secrets.use": 2,
  "progress.publish": 3,
  "secrets.manage": 4,
  "tenant.manage": 4,
};

export interface AuthorizationService {
  authorize(request: AuthorizationRequest): Promise<AuthorizationDecision>;
  require(request: AuthorizationRequest): Promise<void>;
}

export class PostgresTenantAuthorizer implements AuthorizationService {
  constructor(private readonly pool: Pool) {}

  async authorize(request: AuthorizationRequest): Promise<AuthorizationDecision> {
    validateRequest(request);

    let decision: AuthorizationDecision;
    if (request.principal.installationId !== request.scope.installationId) {
      decision = { allowed: false, reason: "principal_tenant_mismatch", roles: [] };
      await this.audit(request, decision);
      return decision;
    }

    const installation = await this.pool.query(
      `SELECT status FROM github_installations WHERE installation_id = $1`,
      [request.scope.installationId],
    );
    if (installation.rowCount !== 1 || installation.rows[0].status !== "active") {
      decision = { allowed: false, reason: "installation_inactive_or_unknown", roles: [] };
      await this.audit(request, decision);
      return decision;
    }

    if (request.scope.repository) {
      const repository = await this.pool.query(
        `SELECT active
         FROM github_repositories
         WHERE installation_id = $1
           AND lower(owner) = lower($2)
           AND lower(name) = lower($3)`,
        [
          request.scope.installationId,
          request.scope.repository.owner,
          request.scope.repository.repo,
        ],
      );
      if (repository.rowCount !== 1 || repository.rows[0].active !== true) {
        decision = { allowed: false, reason: "repository_outside_tenant", roles: [] };
        await this.audit(request, decision);
        return decision;
      }
    }

    const principal = await this.pool.query(
      `SELECT principal_type, active
       FROM tenant_principals
       WHERE installation_id = $1 AND principal_id = $2`,
      [request.scope.installationId, request.principal.principalId],
    );
    if (
      principal.rowCount !== 1 ||
      principal.rows[0].active !== true ||
      principal.rows[0].principal_type !== request.principal.principalType
    ) {
      decision = { allowed: false, reason: "principal_inactive_or_unknown", roles: [] };
      await this.audit(request, decision);
      return decision;
    }

    const roleResult = await this.pool.query(
      `SELECT role
       FROM tenant_role_bindings
       WHERE installation_id = $1 AND principal_id = $2`,
      [request.scope.installationId, request.principal.principalId],
    );
    const roles = roleResult.rows
      .map((row) => row.role as TenantRole)
      .filter((role) => role in ROLE_LEVEL);
    const required = ACTION_LEVEL[request.action];
    const allowed = roles.some((role) => ROLE_LEVEL[role] >= required);
    decision = {
      allowed,
      reason: allowed ? "role_permits_action" : "insufficient_role",
      roles,
    };
    await this.audit(request, decision);
    return decision;
  }

  async require(request: AuthorizationRequest): Promise<void> {
    const decision = await this.authorize(request);
    if (!decision.allowed) {
      throw new AuthorizationError(
        `Denied ${request.action}: ${decision.reason}`,
        request.action,
        decision.reason,
      );
    }
  }

  async upsertPrincipal(
    principal: AuthenticatedPrincipal,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    validatePrincipal(principal);
    await this.pool.query(
      `INSERT INTO tenant_principals(
         installation_id, principal_id, principal_type, active, metadata
       )
       VALUES ($1, $2, $3, true, $4::jsonb)
       ON CONFLICT (installation_id, principal_id) DO UPDATE
       SET principal_type = EXCLUDED.principal_type,
           active = true,
           metadata = tenant_principals.metadata || EXCLUDED.metadata,
           updated_at = now()`,
      [
        principal.installationId,
        principal.principalId,
        principal.principalType,
        JSON.stringify(metadata),
      ],
    );
  }

  async bindRole(
    installationId: number,
    principalId: string,
    role: TenantRole,
  ): Promise<void> {
    validateInstallationId(installationId);
    nonEmpty(principalId, "principalId");
    await this.pool.query(
      `INSERT INTO tenant_role_bindings(installation_id, principal_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [installationId, principalId, role],
    );
  }

  private async audit(
    request: AuthorizationRequest,
    decision: AuthorizationDecision,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO authorization_events(
         installation_id, principal_id, repository_owner, repository_name,
         action, decision, reason, metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        request.scope.installationId,
        request.principal.principalId,
        request.scope.repository?.owner ?? null,
        request.scope.repository?.repo ?? null,
        request.action,
        decision.allowed ? "allow" : "deny",
        decision.reason,
        JSON.stringify({
          principalType: request.principal.principalType,
          roles: decision.roles,
          ...(request.metadata ?? {}),
        }),
      ],
    );
  }
}

export class PostgresTenantBoundary {
  constructor(private readonly pool: Pool) {}

  async requireTask(scope: TenantScope, taskId: string): Promise<void> {
    validateScope(scope);
    const result = await this.pool.query(
      `SELECT 1
       FROM tasks
       WHERE id = $1
         AND installation_id = $2
         AND ($3::text IS NULL OR lower(repository_owner) = lower($3))
         AND ($4::text IS NULL OR lower(repository_name) = lower($4))`,
      [
        taskId,
        scope.installationId,
        scope.repository?.owner ?? null,
        scope.repository?.repo ?? null,
      ],
    );
    if (result.rowCount !== 1) {
      throw new AuthorizationError("Task is outside tenant scope", "task.read", "task_outside_tenant");
    }
  }

  async requireRepository(scope: TenantScope): Promise<void> {
    validateScope(scope);
    if (!scope.repository) throw new Error("Repository scope is required");
    const result = await this.pool.query(
      `SELECT 1
       FROM github_repositories
       WHERE installation_id = $1
         AND lower(owner) = lower($2)
         AND lower(name) = lower($3)
         AND active = true`,
      [scope.installationId, scope.repository.owner, scope.repository.repo],
    );
    if (result.rowCount !== 1) {
      throw new AuthorizationError(
        "Repository is outside tenant scope",
        "repository.read",
        "repository_outside_tenant",
      );
    }
  }
}

export class AuthorizationError extends Error {
  constructor(
    message: string,
    public readonly action: TenantAction,
    public readonly reason: string,
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

function validateRequest(request: AuthorizationRequest): void {
  validatePrincipal(request.principal);
  validateScope(request.scope);
  if (!(request.action in ACTION_LEVEL)) throw new Error(`Unknown action ${request.action}`);
}

function validatePrincipal(principal: AuthenticatedPrincipal): void {
  validateInstallationId(principal.installationId);
  nonEmpty(principal.principalId, "principalId");
}

function validateScope(scope: TenantScope): void {
  validateInstallationId(scope.installationId);
  if (scope.repository) {
    nonEmpty(scope.repository.owner, "repository.owner");
    nonEmpty(scope.repository.repo, "repository.repo");
  }
}

function validateInstallationId(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("installationId must be a positive safe integer");
  }
}

function nonEmpty(value: string, name: string): string {
  if (!value.trim()) throw new Error(`${name} cannot be empty`);
  return value.trim();
}
