-- Isolated additive session audience. Does not grant privileges.
-- NULL remains valid for existing sessions issued before enforcement.
-- Do not apply on speedygo_dev / production without authorization.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS auth_audience varchar(16) NULL;

ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_auth_audience_chk;
ALTER TABLE sessions
  ADD CONSTRAINT sessions_auth_audience_chk
  CHECK (
    auth_audience IS NULL
    OR auth_audience IN ('CUSTOMER', 'MERCHANT', 'DRIVER', 'ADMIN')
  );

CREATE INDEX IF NOT EXISTS sessions_account_audience_active_idx
  ON sessions (account_id, auth_audience)
  WHERE revoked_at IS NULL;
