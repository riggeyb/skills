-- Lead Sentient orchestration and worker-control reliability hardening.

ALTER TABLE sentient_workers
  DROP CONSTRAINT IF EXISTS sentient_workers_spawn_request_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS sentient_workers_spawn_attempt_idx
  ON sentient_workers(spawn_request_id, attempt_count);

CREATE TABLE IF NOT EXISTS task_leadership (
  task_id uuid PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  lead_worker_id uuid NOT NULL REFERENCES sentient_workers(id) ON DELETE RESTRICT,
  epoch integer NOT NULL DEFAULT 1 CHECK (epoch > 0),
  lease_expires_at timestamptz NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  renewed_at timestamptz NOT NULL DEFAULT now(),
  integration_ready_at timestamptz,
  integration_ready_epoch integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_leadership_lease_idx
  ON task_leadership(lease_expires_at);

CREATE TABLE IF NOT EXISTS worker_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  lead_worker_id uuid NOT NULL REFERENCES sentient_workers(id) ON DELETE RESTRICT,
  leadership_epoch integer NOT NULL CHECK (leadership_epoch > 0),
  target_worker_id uuid REFERENCES sentient_workers(id) ON DELETE SET NULL,
  spawn_request_id uuid REFERENCES worker_spawn_requests(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL,
  objective text NOT NULL,
  assignment jsonb NOT NULL,
  acceptance_criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  dependencies jsonb NOT NULL DEFAULT '[]'::jsonb,
  required boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'assigned',
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  handoff jsonb,
  last_review jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(task_id, idempotency_key),
  CHECK (status IN (
    'assigned','acknowledged','in_progress','blocked',
    'handed_off','accepted','rework','cancelled'
  ))
);

CREATE INDEX IF NOT EXISTS worker_assignments_task_status_idx
  ON worker_assignments(task_id, status, required);

CREATE TABLE IF NOT EXISTS lead_directives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  lead_worker_id uuid NOT NULL REFERENCES sentient_workers(id) ON DELETE RESTRICT,
  leadership_epoch integer NOT NULL CHECK (leadership_epoch > 0),
  assignment_id uuid REFERENCES worker_assignments(id) ON DELETE SET NULL,
  directive_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(task_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS lead_assignment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  assignment_id uuid REFERENCES worker_assignments(id) ON DELETE CASCADE,
  lead_worker_id uuid REFERENCES sentient_workers(id) ON DELETE SET NULL,
  leadership_epoch integer,
  event_type text NOT NULL,
  actor text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_assignment_events_assignment_idx
  ON lead_assignment_events(assignment_id, created_at, id);
