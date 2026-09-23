ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS installation_id bigint,
  ADD COLUMN IF NOT EXISTS repository_owner text,
  ADD COLUMN IF NOT EXISTS repository_name text;

UPDATE tasks
SET installation_id = COALESCE(installation_id, NULLIF(origin->>'installationId', '')::bigint),
    repository_owner = COALESCE(repository_owner, origin->'repository'->>'owner'),
    repository_name = COALESCE(repository_name, origin->'repository'->>'repo')
WHERE installation_id IS NULL
   OR repository_owner IS NULL
   OR repository_name IS NULL;

ALTER TABLE tasks
  ALTER COLUMN installation_id SET NOT NULL,
  ALTER COLUMN repository_owner SET NOT NULL,
  ALTER COLUMN repository_name SET NOT NULL;

CREATE INDEX IF NOT EXISTS tasks_tenant_repository_idx
  ON tasks(installation_id, repository_owner, repository_name, created_at DESC);

CREATE TABLE IF NOT EXISTS progress_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  installation_id bigint NOT NULL,
  repository_owner text NOT NULL,
  repository_name text NOT NULL,
  issue_number integer,
  destination text NOT NULL,
  destination_ref text,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 8,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  worker_id text,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (destination IN ('issue_comment', 'discussion_comment')),
  CHECK (status IN ('queued', 'leased', 'delivered', 'dead', 'cancelled')),
  CHECK (max_attempts > 0),
  CHECK (issue_number IS NULL OR issue_number > 0)
);

CREATE INDEX IF NOT EXISTS progress_outbox_lease_idx
  ON progress_outbox(status, available_at, created_at);

CREATE TABLE IF NOT EXISTS tenant_principals (
  installation_id bigint NOT NULL,
  principal_id text NOT NULL,
  principal_type text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, principal_id),
  CHECK (principal_type IN ('github_user', 'service', 'system'))
);

CREATE TABLE IF NOT EXISTS tenant_role_bindings (
  installation_id bigint NOT NULL,
  principal_id text NOT NULL,
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, principal_id, role),
  FOREIGN KEY (installation_id, principal_id)
    REFERENCES tenant_principals(installation_id, principal_id)
    ON DELETE CASCADE,
  CHECK (role IN ('viewer', 'developer', 'operator', 'admin'))
);

CREATE INDEX IF NOT EXISTS tenant_role_bindings_lookup_idx
  ON tenant_role_bindings(installation_id, principal_id, role);

CREATE TABLE IF NOT EXISTS authorization_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id bigint NOT NULL,
  principal_id text NOT NULL,
  repository_owner text,
  repository_name text,
  action text NOT NULL,
  decision text NOT NULL,
  reason text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (decision IN ('allow', 'deny'))
);

CREATE TABLE IF NOT EXISTS secret_leases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id bigint NOT NULL,
  principal_id text NOT NULL,
  provider text NOT NULL,
  secret_name text NOT NULL,
  external_ref text NOT NULL,
  scope jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (installation_id, external_ref)
);

CREATE INDEX IF NOT EXISTS secret_leases_active_idx
  ON secret_leases(installation_id, principal_id, expires_at)
  WHERE revoked_at IS NULL;


CREATE OR REPLACE FUNCTION sentient_fill_task_tenant_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.installation_id := COALESCE(
    NEW.installation_id,
    NULLIF(NEW.origin->>'installationId', '')::bigint
  );
  NEW.repository_owner := COALESCE(
    NEW.repository_owner,
    NEW.origin->'repository'->>'owner'
  );
  NEW.repository_name := COALESCE(
    NEW.repository_name,
    NEW.origin->'repository'->>'repo'
  );

  IF NEW.installation_id IS NULL OR NEW.repository_owner IS NULL OR NEW.repository_name IS NULL THEN
    RAISE EXCEPTION 'task tenant/repository scope is required';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_fill_tenant_columns ON tasks;
CREATE TRIGGER tasks_fill_tenant_columns
BEFORE INSERT OR UPDATE OF origin, installation_id, repository_owner, repository_name
ON tasks
FOR EACH ROW
EXECUTE FUNCTION sentient_fill_task_tenant_columns();
