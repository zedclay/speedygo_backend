-- Isolated speedygo_test reconcile only.
-- Already applied on speedygo_dev via 20261018T0839_admin_preferred_locale.
-- Do not run against speedygo_dev / FX / rehearsal / production.

ALTER TABLE admin_profiles
  ADD COLUMN IF NOT EXISTS preferred_locale varchar(8) NOT NULL DEFAULT 'fr';
