-- Synthetic SpeedyGo development admin for merchant verification acceptance.
-- SYNTHETIC ONLY. Target: 127.0.0.1:5433 / speedygo_dev.
-- Idempotent ON CONFLICT. Does not UPDATE/DELETE unrelated rows.
-- Grants merchants.read + merchants.verify only.
-- Never invoked from Nest application startup.

DO $$
BEGIN
  IF current_database() <> 'speedygo_dev' THEN
    RAISE EXCEPTION
      'Refused merchant lifecycle acceptance seed: expected database speedygo_dev, got %',
      current_database();
  END IF;
END
$$;

INSERT INTO accounts (id, phone, email, status)
VALUES (
  '0d00c074-d000-7000-8000-000000000001',
  '+213550000099',
  NULL,
  'ACTIVE'
)
ON CONFLICT (id) DO UPDATE
SET phone = EXCLUDED.phone
WHERE accounts.phone IS DISTINCT FROM EXCLUDED.phone;

INSERT INTO roles (id, name, description, active)
VALUES (
  '0d00c074-d000-7000-8000-000000000002',
  'speedygo-dev-merchant-lifecycle-acceptance',
  'Synthetic role: merchant verification reject/approve for acceptance only',
  TRUE
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO permissions (id, code, description)
VALUES
  (
    '0d00c074-d000-7000-8000-000000000011',
    'merchants.read',
    'Synthetic fixture: read merchants / verification queue'
  ),
  (
    '0d00c074-d000-7000-8000-000000000012',
    'merchants.verify',
    'Synthetic fixture: approve/reject merchant verification'
  )
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT
  '0d00c074-d000-7000-8000-000000000002',
  p.id
FROM permissions p
WHERE p.code IN ('merchants.read', 'merchants.verify')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO admin_profiles (
  id,
  account_id,
  role_id,
  display_name,
  two_factor_enabled
)
VALUES (
  '0d00c074-d000-7000-8000-000000000003',
  '0d00c074-d000-7000-8000-000000000001',
  '0d00c074-d000-7000-8000-000000000002',
  'SpeedyGo Dev Merchant Lifecycle Acceptance Admin',
  FALSE
)
ON CONFLICT (id) DO NOTHING;
