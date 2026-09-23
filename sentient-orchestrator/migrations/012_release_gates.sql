CREATE TABLE IF NOT EXISTS release_gate_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision text NOT NULL,
  environment text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (status IN ('running', 'passed', 'failed', 'blocked'))
);

CREATE TABLE IF NOT EXISTS release_gate_results (
  run_id uuid NOT NULL REFERENCES release_gate_runs(id) ON DELETE CASCADE,
  gate_key text NOT NULL,
  category text NOT NULL,
  status text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  measured_value double precision,
  threshold_value double precision,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, gate_key),
  CHECK (category IN ('backup', 'recovery', 'load', 'security', 'evaluation', 'smoke')),
  CHECK (status IN ('passed', 'failed', 'blocked'))
);

CREATE INDEX IF NOT EXISTS release_gate_runs_revision_idx
  ON release_gate_runs(revision, environment, started_at DESC);

CREATE OR REPLACE VIEW latest_release_gate_runs AS
SELECT DISTINCT ON (environment)
  id, revision, environment, status, metadata, started_at, completed_at
FROM release_gate_runs
ORDER BY environment, started_at DESC;
