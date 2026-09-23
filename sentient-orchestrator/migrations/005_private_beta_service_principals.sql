INSERT INTO tenant_principals(installation_id, principal_id, principal_type, active, metadata)
SELECT installation_id, 'sentient-reporter', 'service', true, '{"managed":true}'::jsonb
FROM github_installations
WHERE status = 'active'
ON CONFLICT (installation_id, principal_id) DO UPDATE
SET active = true, principal_type = 'service', updated_at = now();

INSERT INTO tenant_role_bindings(installation_id, principal_id, role)
SELECT installation_id, 'sentient-reporter', 'operator'
FROM github_installations
WHERE status = 'active'
ON CONFLICT DO NOTHING;
