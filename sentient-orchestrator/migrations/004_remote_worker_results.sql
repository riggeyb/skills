ALTER TABLE sentient_workers
  ADD COLUMN IF NOT EXISTS runtime_result jsonb;

CREATE TABLE IF NOT EXISTS remote_worker_events(
  id bigserial PRIMARY KEY,
  worker_id uuid NOT NULL REFERENCES sentient_workers(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS remote_worker_events_worker_idx
  ON remote_worker_events(worker_id,created_at);
