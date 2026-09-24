-- Durable Sentient-to-Sentient coordination transport.

CREATE TABLE IF NOT EXISTS sentient_coordination_messages (
  message_id uuid PRIMARY KEY,
  protocol_version text NOT NULL,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tenant text NOT NULL,
  repository_owner text NOT NULL,
  repository_name text NOT NULL,
  sender_worker_id uuid NOT NULL REFERENCES sentient_workers(id) ON DELETE CASCADE,
  target_kind text NOT NULL,
  recipient_worker_id uuid REFERENCES sentient_workers(id) ON DELETE CASCADE,
  message_type text NOT NULL,
  correlation_id text NOT NULL,
  causation_id uuid,
  payload jsonb NOT NULL,
  sender_leadership_epoch bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (target_kind IN ('worker','lead','task')),
  CHECK (
    (target_kind='worker' AND recipient_worker_id IS NOT NULL)
    OR (target_kind IN ('lead','task') AND recipient_worker_id IS NULL)
  ),
  CHECK (message_type IN (
    'QUESTION','ANSWER','FINDING','PROPOSAL','DECISION','DEPENDENCY','BLOCKER',
    'HANDOFF','STATUS','DONE','DIRECTIVE','ESCALATION'
  ))
);

CREATE INDEX IF NOT EXISTS sentient_coordination_messages_task_created_idx
  ON sentient_coordination_messages(task_id, created_at, message_id);

CREATE INDEX IF NOT EXISTS sentient_coordination_messages_correlation_idx
  ON sentient_coordination_messages(task_id, correlation_id, created_at);

CREATE TABLE IF NOT EXISTS sentient_coordination_deliveries (
  message_id uuid NOT NULL REFERENCES sentient_coordination_messages(message_id) ON DELETE CASCADE,
  recipient_worker_id uuid NOT NULL REFERENCES sentient_workers(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'pending',
  delivery_attempts integer NOT NULL DEFAULT 0,
  first_delivered_at timestamptz,
  last_delivered_at timestamptz,
  next_delivery_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  dead_letter_reason text,
  PRIMARY KEY(message_id, recipient_worker_id),
  CHECK (state IN ('pending','delivered','acknowledged','dead_letter')),
  CHECK (delivery_attempts >= 0)
);

CREATE INDEX IF NOT EXISTS sentient_coordination_deliveries_pending_idx
  ON sentient_coordination_deliveries(recipient_worker_id, state, next_delivery_at);
