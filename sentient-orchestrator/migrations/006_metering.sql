CREATE TABLE IF NOT EXISTS usage_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE,
  installation_id bigint NOT NULL REFERENCES github_installations(installation_id),
  repository_owner text,
  repository_name text,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  agent_role text,
  action_run_id uuid REFERENCES action_runs(id) ON DELETE SET NULL,
  category text NOT NULL,
  source text NOT NULL,
  quantity bigint NOT NULL DEFAULT 0,
  unit text NOT NULL,
  cost_microusd bigint NOT NULL DEFAULT 0,
  correlation_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (category IN ('model', 'compute', 'storage', 'network')),
  CHECK (quantity >= 0),
  CHECK (cost_microusd >= 0)
);

CREATE INDEX IF NOT EXISTS usage_ledger_tenant_month_idx
  ON usage_ledger(installation_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS usage_ledger_task_idx
  ON usage_ledger(task_id, occurred_at DESC)
  WHERE task_id IS NOT NULL;

CREATE OR REPLACE FUNCTION sentient_usage_ledger_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'usage_ledger is append-only';
END;
$$;

DROP TRIGGER IF EXISTS usage_ledger_immutable_update ON usage_ledger;
CREATE TRIGGER usage_ledger_immutable_update
BEFORE UPDATE OR DELETE ON usage_ledger
FOR EACH ROW
EXECUTE FUNCTION sentient_usage_ledger_immutable();

CREATE TABLE IF NOT EXISTS tenant_budgets (
  installation_id bigint PRIMARY KEY REFERENCES github_installations(installation_id) ON DELETE CASCADE,
  monthly_limit_microusd bigint NOT NULL,
  soft_limit_percent integer NOT NULL DEFAULT 80,
  hard_limit boolean NOT NULL DEFAULT true,
  enabled boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (monthly_limit_microusd > 0),
  CHECK (soft_limit_percent BETWEEN 1 AND 100)
);

CREATE TABLE IF NOT EXISTS budget_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_key text NOT NULL UNIQUE,
  installation_id bigint NOT NULL REFERENCES github_installations(installation_id) ON DELETE CASCADE,
  repository_owner text,
  repository_name text,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  amount_microusd bigint NOT NULL,
  status text NOT NULL DEFAULT 'active',
  expires_at timestamptz NOT NULL,
  committed_event_key text,
  correlation_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (amount_microusd > 0),
  CHECK (status IN ('active', 'committed', 'released', 'expired'))
);

CREATE INDEX IF NOT EXISTS budget_reservations_active_idx
  ON budget_reservations(installation_id, expires_at)
  WHERE status = 'active';

CREATE OR REPLACE VIEW tenant_monthly_usage AS
SELECT
  installation_id,
  date_trunc('month', occurred_at) AS month_start,
  category,
  sum(quantity)::bigint AS quantity,
  sum(cost_microusd)::bigint AS cost_microusd
FROM usage_ledger
GROUP BY installation_id, date_trunc('month', occurred_at), category;

CREATE OR REPLACE VIEW model_cost_per_success AS
SELECT
  mc.provider,
  mc.model,
  mc.capability,
  count(*) FILTER (WHERE mc.status = 'succeeded')::bigint AS successful_calls,
  count(*) FILTER (WHERE mc.status = 'failed')::bigint AS failed_calls,
  coalesce(sum(mc.cost_microusd), 0)::bigint AS total_cost_microusd,
  CASE
    WHEN count(*) FILTER (WHERE mc.status = 'succeeded') = 0 THEN NULL
    ELSE (
      coalesce(sum(mc.cost_microusd), 0)::numeric /
      count(*) FILTER (WHERE mc.status = 'succeeded')
    )
  END AS cost_per_success_microusd
FROM model_calls mc
GROUP BY mc.provider, mc.model, mc.capability;
