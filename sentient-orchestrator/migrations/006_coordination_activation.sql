-- Autonomous coordination activation and bounded delivery retry policy.

ALTER TABLE sentient_coordination_deliveries
  ADD COLUMN IF NOT EXISTS max_delivery_attempts integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz;

ALTER TABLE sentient_coordination_deliveries
  DROP CONSTRAINT IF EXISTS sentient_coordination_deliveries_max_delivery_attempts_check;
ALTER TABLE sentient_coordination_deliveries
  ADD CONSTRAINT sentient_coordination_deliveries_max_delivery_attempts_check
  CHECK (max_delivery_attempts > 0);

CREATE TABLE IF NOT EXISTS sentient_coordination_activations (
  activation_id text PRIMARY KEY,
  message_id uuid NOT NULL,
  recipient_worker_id uuid NOT NULL REFERENCES sentient_workers(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'pending',
  activation_attempts integer NOT NULL DEFAULT 0,
  max_activation_attempts integer NOT NULL DEFAULT 3,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claim_owner text,
  claim_expires_at timestamptz,
  runtime_handle text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  FOREIGN KEY(message_id,recipient_worker_id)
    REFERENCES sentient_coordination_deliveries(message_id,recipient_worker_id)
    ON DELETE CASCADE,
  UNIQUE(message_id,recipient_worker_id),
  CHECK (state IN ('pending','claimed','running','completed','dead_letter')),
  CHECK (activation_attempts >= 0),
  CHECK (max_activation_attempts > 0)
);

CREATE INDEX IF NOT EXISTS sentient_coordination_activations_due_idx
  ON sentient_coordination_activations(state,next_attempt_at,created_at);

CREATE UNIQUE INDEX IF NOT EXISTS sentient_coordination_one_active_per_worker_idx
  ON sentient_coordination_activations(recipient_worker_id)
  WHERE state IN ('claimed','running');

CREATE TABLE IF NOT EXISTS worker_coordination_runtime_executions (
  runtime_handle text PRIMARY KEY,
  activation_id text NOT NULL REFERENCES sentient_coordination_activations(activation_id) ON DELETE CASCADE,
  worker_id uuid NOT NULL REFERENCES sentient_workers(id) ON DELETE CASCADE,
  execution_attempt integer NOT NULL,
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
  UNIQUE(activation_id,execution_attempt),
  CHECK (execution_attempt > 0),
  CHECK (status IN ('starting','running','completed','failed','cancelled')),
  CHECK (spent_usd >= 0)
);

CREATE INDEX IF NOT EXISTS worker_coordination_runtime_execution_worker_idx
  ON worker_coordination_runtime_executions(worker_id,created_at);
