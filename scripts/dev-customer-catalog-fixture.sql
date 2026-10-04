-- Isolated SpeedyGo development catalog fixture.
-- SYNTHETIC ONLY. Never apply to speedygo_test, production, or shared ports.
-- Target: 127.0.0.1:5433 / speedygo_dev
-- Idempotent on primary keys. Does not UPDATE, DELETE, or grant live-account membership.

DO $$
BEGIN
  IF current_database() <> 'speedygo_dev' THEN
    RAISE EXCEPTION
      'Refused catalog fixture: expected database speedygo_dev, got %',
      current_database();
  END IF;
END
$$;

-- Demo owner account (no CustomerProfile, no role grants to real users).
INSERT INTO accounts (id, phone, email, status)
VALUES (
  '0d00c070-d000-7000-8000-000000000001',
  '+213000000099',
  NULL,
  'ACTIVE'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO merchants (
  id,
  public_reference,
  name,
  status,
  verified_at
)
VALUES (
  '0d00c070-d000-7000-8000-000000000002',
  'sgm_dev_demo_catalog',
  'SpeedyGo Demo Catalogue',
  'ACTIVE',
  NOW()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO merchant_branches (
  id,
  merchant_id,
  name,
  phone,
  address_text,
  latitude,
  longitude,
  operational_status
)
VALUES (
  '0d00c070-d000-7000-8000-000000000003',
  '0d00c070-d000-7000-8000-000000000002',
  'Demo Cafe Hydra',
  '+213000000098',
  '1 chemin de la Demo, Hydra, Alger',
  36.753470,
  3.052140,
  'ACTIVE'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO merchant_branch_opening_schedules (
  id,
  branch_id,
  version,
  updated_by_account_id
)
VALUES (
  '0d00c070-d000-7000-8000-000000000004',
  '0d00c070-d000-7000-8000-000000000003',
  1,
  '0d00c070-d000-7000-8000-000000000001'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO merchant_branch_opening_intervals (
  id,
  schedule_id,
  day_of_week,
  opens_minute,
  closes_minute,
  closes_next_day,
  sort_order
)
SELECT
  ('0d00c070-d000-7000-8000-00000000004' || d.day)::uuid,
  '0d00c070-d000-7000-8000-000000000004',
  d.day,
  480,
  1320,
  FALSE,
  0
FROM generate_series(1, 7) AS d(day)
ON CONFLICT (id) DO NOTHING;

INSERT INTO categories (
  id,
  merchant_branch_id,
  name,
  sort_order,
  active
)
VALUES
  (
    '0d00c070-d000-7000-8000-000000000010',
    '0d00c070-d000-7000-8000-000000000003',
    'Boissons Demo',
    1,
    TRUE
  ),
  (
    '0d00c070-d000-7000-8000-000000000011',
    '0d00c070-d000-7000-8000-000000000003',
    'Patisserie Demo',
    2,
    TRUE
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO products (
  id,
  merchant_branch_id,
  category_id,
  name,
  description,
  price_minor,
  available
)
VALUES
  (
    '0d00c070-d000-7000-8000-000000000020',
    '0d00c070-d000-7000-8000-000000000003',
    '0d00c070-d000-7000-8000-000000000010',
    'Espresso Demo',
    'Cafe serre synthetique pour le catalogue Customer.',
    1200,
    TRUE
  ),
  (
    '0d00c070-d000-7000-8000-000000000021',
    '0d00c070-d000-7000-8000-000000000003',
    '0d00c070-d000-7000-8000-000000000011',
    'Croissant Demo',
    'Viennoiserie synthetique.',
    850,
    TRUE
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO product_option_groups (
  id,
  product_id,
  name,
  required,
  min_selections,
  max_selections
)
VALUES (
  '0d00c070-d000-7000-8000-000000000030',
  '0d00c070-d000-7000-8000-000000000020',
  'Taille Demo',
  TRUE,
  1,
  1
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO product_options (
  id,
  option_group_id,
  name,
  additional_price_minor,
  available
)
VALUES
  (
    '0d00c070-d000-7000-8000-000000000031',
    '0d00c070-d000-7000-8000-000000000030',
    'Simple',
    0,
    TRUE
  ),
  (
    '0d00c070-d000-7000-8000-000000000032',
    '0d00c070-d000-7000-8000-000000000030',
    'Double',
    200,
    TRUE
  )
ON CONFLICT (id) DO NOTHING;
