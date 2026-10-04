-- Companion GLOBAL_DEFAULT commission for Order creation on speedygo_dev.
-- Preview does not require this. Safe rerun: inserts only when no active
-- open GLOBAL_DEFAULT exists. Never mutates unrelated rules.
DO $$
BEGIN
  IF current_database() <> 'speedygo_dev' THEN
    RAISE EXCEPTION
      'Refused commission companion seed: expected speedygo_dev, got %',
      current_database();
  END IF;
END
$$;

INSERT INTO merchant_commission_rules (
  id,
  scope,
  merchant_id,
  rate_bps,
  effective_from,
  effective_to,
  change_reason,
  changed_by_admin_id,
  active,
  created_at
)
SELECT
  '01a086cd-b5c0-7000-8000-00000000c001',
  'GLOBAL_DEFAULT',
  NULL,
  700,
  '2020-01-01T00:00:00.000Z',
  NULL,
  'SpeedyGo Dev Revue synthetic GLOBAL_DEFAULT for COD order creation',
  '0d00c072-d000-7000-8000-000000000003',
  TRUE,
  now()
WHERE NOT EXISTS (
  SELECT 1
  FROM merchant_commission_rules
  WHERE scope = 'GLOBAL_DEFAULT'
    AND active = TRUE
    AND effective_to IS NULL
);
