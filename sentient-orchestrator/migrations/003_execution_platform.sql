CREATE TABLE IF NOT EXISTS action_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  installation_id bigint NOT NULL,
  repository_owner text NOT NULL,
  repository_name text NOT NULL,
  workflow_name text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  source_sha text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS action_jobs (
  run_id uuid NOT NULL REFERENCES action_runs(id) ON DELETE CASCADE,
  job_key text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  needs text[] NOT NULL DEFAULT '{}',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 1,
  summary text,
  started_at timestamptz,
  completed_at timestamptz,
  PRIMARY KEY (run_id, job_key),
  CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'skipped'))
);

CREATE TABLE IF NOT EXISTS workspace_runs (
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_id text NOT NULL,
  sandbox_id text,
  branch text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, agent_id),
  CHECK (status IN ('active', 'integrated', 'failed', 'destroyed'))
);

CREATE TABLE IF NOT EXISTS artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id bigint NOT NULL,
  repository_owner text NOT NULL,
  repository_name text NOT NULL,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  run_id uuid REFERENCES action_runs(id) ON DELETE SET NULL,
  kind text NOT NULL,
  object_key text NOT NULL UNIQUE,
  sha256 text NOT NULL,
  size_bytes bigint NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (size_bytes >= 0)
);

CREATE INDEX IF NOT EXISTS artifacts_tenant_repo_created_idx
  ON artifacts(installation_id, repository_owner, repository_name, created_at DESC);

CREATE TABLE IF NOT EXISTS cache_entries (
  installation_id bigint NOT NULL,
  repository_owner text NOT NULL,
  repository_name text NOT NULL,
  cache_key text NOT NULL,
  object_key text NOT NULL,
  sha256 text NOT NULL,
  size_bytes bigint NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_accessed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, repository_owner, repository_name, cache_key),
  CHECK (size_bytes >= 0)
);

CREATE TABLE IF NOT EXISTS github_check_runs (
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  action_run_id uuid REFERENCES action_runs(id) ON DELETE SET NULL,
  installation_id bigint NOT NULL,
  repository_id bigint,
  repository_owner text NOT NULL,
  repository_name text NOT NULL,
  check_run_id bigint NOT NULL,
  name text NOT NULL,
  head_sha text NOT NULL,
  status text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, repository_owner, repository_name, check_run_id),
  CHECK (status IN ('queued', 'in_progress', 'completed'))
);
