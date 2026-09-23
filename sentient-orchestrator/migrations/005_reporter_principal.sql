ALTER TABLE tenant_principals
  DROP CONSTRAINT IF EXISTS tenant_principals_installation_fk;

ALTER TABLE tenant_principals
  ADD CONSTRAINT tenant_principals_installation_fk
  FOREIGN KEY (installation_id)
  REFERENCES github_installations(installation_id)
  ON DELETE CASCADE;

INSERT INTO tenant_principals(
  installation_id, principal_id, principal_type, active, metadata
)
SELECT
  installation_id,
  'sentient-reporter',
  'service',
  status = 'active',
  '{"managedBy":"sentient","purpose":"progress-reporting"}'::jsonb
FROM github_installations
ON CONFLICT (installation_id, principal_id) DO UPDATE
SET principal_type = EXCLUDED.principal_type,
    active = EXCLUDED.active,
    metadata = tenant_principals.metadata || EXCLUDED.metadata,
    updated_at = now();

INSERT INTO tenant_role_bindings(installation_id, principal_id, role)
SELECT installation_id, 'sentient-reporter', 'operator'
FROM github_installations
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION sentient_sync_reporter_principal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO tenant_principals(
    installation_id, principal_id, principal_type, active, metadata
  )
  VALUES (
    NEW.installation_id,
    'sentient-reporter',
    'service',
    NEW.status = 'active',
    '{"managedBy":"sentient","purpose":"progress-reporting"}'::jsonb
  )
  ON CONFLICT (installation_id, principal_id) DO UPDATE
  SET principal_type = EXCLUDED.principal_type,
      active = EXCLUDED.active,
      metadata = tenant_principals.metadata || EXCLUDED.metadata,
      updated_at = now();

  INSERT INTO tenant_role_bindings(installation_id, principal_id, role)
  VALUES (NEW.installation_id, 'sentient-reporter', 'operator')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS github_installations_sync_reporter ON github_installations;
CREATE TRIGGER github_installations_sync_reporter
AFTER INSERT OR UPDATE OF status
ON github_installations
FOR EACH ROW
EXECUTE FUNCTION sentient_sync_reporter_principal();
