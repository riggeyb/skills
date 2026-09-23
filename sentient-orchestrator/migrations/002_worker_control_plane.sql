CREATE TABLE IF NOT EXISTS worker_spawn_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tenant text NOT NULL,
  repository_owner text NOT NULL,
  repository_name text NOT NULL,
  role text NOT NULL,
  subtask jsonb NOT NULL,
  required_capabilities text[] NOT NULL DEFAULT '{}',
  preferred_model_tier text,
  max_cost_usd numeric,
  max_duration_ms bigint,
  repository_permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  workspace_requirement jsonb,
  parent_worker_id uuid,
  coordinator_id text,
  idempotency_key text NOT NULL,
  correlation_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  claim_owner text,
  claim_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant, idempotency_key),
  CHECK (status IN ('pending', 'claimed', 'scheduled', 'blocked', 'completed', 'failed', 'cancelled')),
  CHECK (max_cost_usd IS NULL OR max_cost_usd >= 0),
  CHECK (max_attempts > 0)
);

CREATE TABLE IF NOT EXISTS sentient_workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spawn_request_id uuid NOT NULL UNIQUE REFERENCES worker_spawn_requests(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tenant text NOT NULL,
  repository_owner text NOT NULL,
  repository_name text NOT NULL,
  role text NOT NULL,
  assignment jsonb NOT NULL,
  status text NOT NULL,
  runtime_id text,
  runtime_handle text,
  model_provider_requirements jsonb NOT NULL DEFAULT '{}'::jsonb,
  capabilities text[] NOT NULL DEFAULT '{}',
  authority jsonb NOT NULL DEFAULT '{}'::jsonb,
  branch_assignment text,
  workspace_assignment jsonb,
  budget_usd numeric,
  spent_usd numeric NOT NULL DEFAULT 0,
  lease_owner text,
  lease_expires_at timestamptz,
  last_heartbeat_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 1,
  parent_worker_id uuid,
  coordinator_id text,
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  failure_reason text,
  termination_reason text,
  CHECK (status IN ('pending', 'assigned', 'starting', 'running', 'blocked', 'waiting', 'completed', 'failed', 'cancelled', 'expired')),
  CHECK (budget_usd IS NULL OR budget_usd >= 0),
  CHECK (spent_usd >= 0)
);

ALTER TABLE worker_spawn_requests
  ADD CONSTRAINT worker_spawn_parent_fk FOREIGN KEY (parent_worker_id) REFERENCES sentient_workers(id) ON DELETE SET NULL;
ALTER TABLE sentient_workers
  ADD CONSTRAINT sentient_worker_parent_fk FOREIGN KEY (parent_worker_id) REFERENCES sentient_workers(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS worker_dependencies (
  spawn_request_id uuid NOT NULL REFERENCES worker_spawn_requests(id) ON DELETE CASCADE,
  depends_on_worker_id uuid NOT NULL REFERENCES sentient_workers(id) ON DELETE CASCADE,
  PRIMARY KEY (spawn_request_id, depends_on_worker_id)
);

CREATE INDEX IF NOT EXISTS worker_spawn_schedule_idx
  ON worker_spawn_requests(status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS sentient_worker_lease_idx
  ON sentient_workers(status, lease_expires_at);
CREATE INDEX IF NOT EXISTS sentient_worker_task_idx
  ON sentient_workers(task_id, status);
