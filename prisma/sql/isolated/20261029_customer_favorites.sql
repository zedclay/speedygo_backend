-- Isolated-database only. Not an operational Prisma 8 migration onto shared hosts.
-- Customer favorite storefronts and products (Draft discovery candidate).
-- Apply only on disposable isolated databases (speedygo_test, *_isolated_money, etc.).
-- Do not apply to shared speedygo_dev.

DO $$
BEGIN
  IF current_database() IN (
    'speedygo_dev',
    'speedygo',
    'speedygo_parity_fx',
    'speedygo_money_migrate_rehearsal',
    'postgres'
  ) THEN
    RAISE EXCEPTION
      'refusing customer_favorites DDL on shared database %',
      current_database();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS customer_favorites (
  id UUID PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES customer_profiles (id) ON DELETE RESTRICT,
  target_kind VARCHAR(16) NOT NULL,
  target_id UUID NOT NULL,
  branch_id UUID NOT NULL REFERENCES merchant_branches (id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT customer_favorites_kind CHECK (target_kind IN ('BRANCH', 'PRODUCT')),
  CONSTRAINT customer_favorites_owner_target UNIQUE (customer_id, target_kind, target_id)
);

CREATE INDEX IF NOT EXISTS customer_favorites_customer_created
  ON customer_favorites (customer_id, created_at);
