ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS correlation_id text;

UPDATE tasks
SET correlation_id = COALESCE(NULLIF(correlation_id, ''), origin->>'deliveryId', delivery_id)
WHERE correlation_id IS NULL OR correlation_id = '';

ALTER TABLE tasks
  ALTER COLUMN correlation_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS tasks_correlation_idx ON tasks(correlation_id);

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS correlation_id text;

UPDATE jobs
SET correlation_id = COALESCE(
  NULLIF(correlation_id, ''),
  payload->'origin'->>'deliveryId',
  payload->>'deliveryId',
  idempotency_key
)
WHERE correlation_id IS NULL OR correlation_id = '';

ALTER TABLE jobs
  ALTER COLUMN correlation_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS jobs_correlation_idx ON jobs(correlation_id);

ALTER TABLE model_calls ADD COLUMN IF NOT EXISTS correlation_id text;
ALTER TABLE action_runs ADD COLUMN IF NOT EXISTS correlation_id text;
ALTER TABLE progress_outbox ADD COLUMN IF NOT EXISTS correlation_id text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS correlation_id text;
ALTER TABLE authorization_events ADD COLUMN IF NOT EXISTS correlation_id text;
ALTER TABLE secret_leases ADD COLUMN IF NOT EXISTS correlation_id text;

CREATE INDEX IF NOT EXISTS model_calls_correlation_idx ON model_calls(correlation_id);
CREATE INDEX IF NOT EXISTS action_runs_correlation_idx ON action_runs(correlation_id);
CREATE INDEX IF NOT EXISTS progress_outbox_correlation_idx ON progress_outbox(correlation_id);
CREATE INDEX IF NOT EXISTS audit_events_correlation_idx ON audit_events(correlation_id);
CREATE INDEX IF NOT EXISTS authorization_events_correlation_idx ON authorization_events(correlation_id);
CREATE INDEX IF NOT EXISTS secret_leases_correlation_idx ON secret_leases(correlation_id);
