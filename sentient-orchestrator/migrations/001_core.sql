CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS github_deliveries (
  delivery_id text PRIMARY KEY,
  claimed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id text NOT NULL UNIQUE,
  objective text NOT NULL,
  status text NOT NULL,
  origin jsonb NOT NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_agents (
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  role text NOT NULL,
  status text NOT NULL,
  summary text,
  started_at timestamptz,
  completed_at timestamptz,
  PRIMARY KEY (task_id, role)
);

CREATE TABLE IF NOT EXISTS task_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  role text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_messages_task_created_idx
  ON task_messages(task_id, created_at, id);

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  priority integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  worker_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('queued', 'leased', 'completed', 'dead', 'cancelled')),
  CHECK (max_attempts > 0)
);

CREATE INDEX IF NOT EXISTS jobs_lease_idx
  ON jobs(status, available_at, priority DESC, created_at);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id bigint,
  repository_owner text,
  repository_name text,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  actor text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_events_task_created_idx
  ON audit_events(task_id, created_at);
