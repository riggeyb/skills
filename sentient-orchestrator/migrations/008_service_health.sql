CREATE TABLE IF NOT EXISTS service_heartbeats (
  service text NOT NULL,
  instance_id text NOT NULL,
  revision text,
  status text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (service, instance_id),
  CHECK (status IN ('starting', 'ready', 'degraded', 'stopping'))
);

CREATE INDEX IF NOT EXISTS service_heartbeats_seen_idx
  ON service_heartbeats(service, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS operational_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE,
  severity text NOT NULL,
  service text NOT NULL,
  event_name text NOT NULL,
  installation_id bigint,
  repository_owner text,
  repository_name text,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  correlation_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (severity IN ('debug', 'info', 'warn', 'error', 'critical'))
);

CREATE INDEX IF NOT EXISTS operational_events_correlation_idx
  ON operational_events(correlation_id, created_at DESC);
