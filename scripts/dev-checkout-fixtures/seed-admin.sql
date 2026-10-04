-- Synthetic SpeedyGo development checkout-fixture admin actor.
-- SYNTHETIC ONLY. Target: 127.0.0.1:5433 / speedygo_dev.
-- Idempotent ON CONFLICT. Does not UPDATE/DELETE unrelated rows.
-- Does not grant privileges to real users.

DO $$
BEGIN
  IF current_database() <> 'speedygo_dev' THEN
    RAISE EXCEPTION
      'Refused checkout fixtures seed: expected database speedygo_dev, got %',
      current_database();
  END IF;
END
$$;

INSERT INTO accounts (id, phone, email, status)
VALUES (
  '0d00c072-d000-7000-8000-000000000001',
  '+213550000097',
  NULL,
  'ACTIVE'
)
ON CONFLICT (id) DO UPDATE
SET phone = EXCLUDED.phone
WHERE accounts.phone IS DISTINCT FROM EXCLUDED.phone;

INSERT INTO roles (id, name, description, active)
VALUES (
  '0d00c072-d000-7000-8000-000000000002',
  'speedygo-dev-checkout-fixtures',
  'Synthetic role for development checkout zone/pricing fixtures only',
  TRUE
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO permissions (id, code, description)
VALUES
  (
    '0d00c072-d000-7000-8000-000000000011',
    'delivery.zones.read',
    'Synthetic fixture: list/read delivery zones'
  ),
  (
    '0d00c072-d000-7000-8000-000000000012',
    'delivery.zones.manage',
    'Synthetic fixture: create/activate delivery zones'
  ),
  (
    '0d00c072-d000-7000-8000-000000000013',
    'delivery.pricing.read',
    'Synthetic fixture: list/read delivery pricing rules'
  ),
  (
    '0d00c072-d000-7000-8000-000000000014',
    'delivery.pricing.manage',
    'Synthetic fixture: create/activate delivery pricing rules'
  )
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT
  '0d00c072-d000-7000-8000-000000000002',
  p.id
FROM permissions p
WHERE p.code IN (
  'delivery.zones.read',
  'delivery.zones.manage',
  'delivery.pricing.read',
  'delivery.pricing.manage'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO admin_profiles (
  id,
  account_id,
  role_id,
  display_name,
  two_factor_enabled
)
VALUES (
  '0d00c072-d000-7000-8000-000000000003',
  '0d00c072-d000-7000-8000-000000000001',
  '0d00c072-d000-7000-8000-000000000002',
  'SpeedyGo Dev Checkout Fixtures',
  FALSE
)
ON CONFLICT (id) DO NOTHING;
