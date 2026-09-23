CREATE TABLE IF NOT EXISTS github_installations (
  installation_id bigint PRIMARY KEY,
  account_login text,
  account_type text,
  status text NOT NULL DEFAULT 'active',
  permissions jsonb NOT NULL DEFAULT ' {} '::jsonb,
  installed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('active', 'suspended', 'deleted'))
);

CREATE TABLE IF NOT EXISTS github_repositories (
  installation_id bigint NOT NULL REFERENCES github_installations(installation_id) ON DELETE CASCADE,
  repository_id bigint NOT NULL,
  owner text NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, repository_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS github_repositories_owner_name_uid
  ON github_repositories(installation_id, owner, name);

ALTER TABLE task_messages
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'NOTE',
  ADD COLUMN IF NOT EXISTS from_agent text,
  ADD COLUMN IF NOT EXISTS to_agent text,
  ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS task_messages_typed_idx
  ON task_messages(task_id, kind, created_at);

CREATE TABLE IF NOT EXISTS task_resource_claims (
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  resource_key text NOT NULL,
  agent_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, resource_key)
);

CREATE TABLE IF NOT EXISTS model_catalog (
  provider text NOT NULL,
  model text NOT NULL,
  capabilities text[] NOT NULL,
  input_cost_per_million_microusd bigint NOT NULL,
  output_cost_per_million_microusd bigint NOT NULL,
  quality_score double precision NOT NULL,
  latency_score double precision NOT NULL,
  context_tokens integer NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, model),
  CHECK (quality_score >= 0 AND quality_score <= 1),
  CHECK (latency_score >= 0 AND latency_score <= 1)
);

CREATE TABLE IF NOT EXISTS model_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
  agent_role text,
  provider text NOT NULL,
  model text NOT NULL,
  capability text NOT NULL,
  status text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cost_microusd bigint NOT NULL DEFAULT 0,
  latency_ms integer,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('succeeded', 'failed'))
);

CREATE TABLE IF NOT EXISTS task_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  node_key text NOT NULL,
  role text NOT NULL,
  objective text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  priority integer NOT NULL DEFAULT 0,
  summary text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, node_key),
  CHECK (status IN ('queued', 'running', 'blocked', 'completed', 'failed', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS task_node_dependencies (
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  node_key text NOT NULL,
  depends_on_key text NOT NULL,
  PRIMARY KEY (task_id, node_key, depends_on_key),
  FOREIGN KEY (task_id, node_key) REFERENCES task_nodes(task_id, node_key) ON DELETE CASCADE,
  FOREIGN KEY (task_id, depends_on_key) REFERENCES task_nodes(task_id, node_key) ON DELETE CASCADE,
  CHECK (node_key <> depends_on_key)
);

CREATE INDEX IF NOT EXISTS task_nodes_ready_idx
  ON task_nodes(task_id, status, priority DESC);
