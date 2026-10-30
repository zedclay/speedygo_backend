-- Only for disposable speedygo_test. Do not drop preferred_locale on speedygo_dev.

ALTER TABLE admin_profiles DROP COLUMN IF EXISTS preferred_locale;
