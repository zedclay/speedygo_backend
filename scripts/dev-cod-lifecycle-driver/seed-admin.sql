-- Synthetic SpeedyGo development admin for COD lifecycle driver approval.
-- SYNTHETIC ONLY. Target: 127.0.0.1:5433 / speedygo_dev.
-- Idempotent ON CONFLICT. Does not UPDATE/DELETE unrelated rows.
-- Does not grant privileges to real users (Bousbaa / live phones).

DO $$
BEGIN
  IF current_database() <> 'speedygo_dev' THEN
    RAISE EXCEPTION
      'Refused COD lifecycle driver fixture seed: expected database speedygo_dev, got %',
      current_database();
  END IF;
END
$$;

INSERT INTO accounts (id, phone, email, status)
VALUES (
  '0d00c073-d000-7000-8000-000000000001',
  '+213550000098',
  NULL,
  'ACTIVE'
)
ON CONFLICT (id) DO UPDATE
SET phone = EXCLUDED.phone
WHERE accounts.phone IS DISTINCT FROM EXCLUDED.phone;

INSERT INTO roles (id, name, description, active)
VALUES (
  '0d00c073-d000-7000-8000-000000000002',
  'speedygo-dev-cod-lifecycle-driver',
  'Synthetic role: approve development COD lifecycle driver only',
  TRUE
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO permissions (id, code, description)
VALUES
  (
    '0d00c073-d000-7000-8000-000000000011',
    'drivers.read',
    'Synthetic fixture: read drivers'
  ),
  (
    '0d00c073-d000-7000-8000-000000000012',
    'drivers.verify',
    'Synthetic fixture: approve/reject driver verification'
  )
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT
  '0d00c073-d000-7000-8000-000000000002',
  p.id
FROM permissions p
WHERE p.code IN ('drivers.read', 'drivers.verify')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO admin_profiles (
  id,
  account_id,
  role_id,
  display_name,
  two_factor_enabled
)
VALUES (
  '0d00c073-d000-7000-8000-000000000003',
  '0d00c073-d000-7000-8000-000000000001',
  '0d00c073-d000-7000-8000-000000000002',
  'SpeedyGo Dev COD Lifecycle Driver Admin',
  FALSE
)
ON CONFLICT (id) DO NOTHING;
