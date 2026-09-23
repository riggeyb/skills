-- Durable provider-neutral model-backed worker execution state.

CREATE TABLE IF NOT EXISTS worker_runtime_executions (
  worker_id uuid PRIMARY KEY REFERENCES sentient_workers(id) ON DELETE CASCADE,
  runtime_handle text NOT NULL UNIQUE,
  runtime_id text NOT NULL,
  adapter_id text NOT NULL,
  provider_id text NOT NULL,
  model_id text,
  request jsonb NOT NULL,
  request_hash text NOT NULL,
  assignment_hash text NOT NULL,
  status text NOT NULL DEFAULT 'starting',
  result jsonb,
  failure_reason text,
  spent_usd numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('starting','running','completed','failed','cancelled')),
  CHECK (spent_usd >= 0)
);

CREATE INDEX IF NOT EXISTS worker_runtime_execution_status_idx
  ON worker_runtime_executions(status, updated_at);
