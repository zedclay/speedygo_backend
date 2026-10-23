-- Reverse of 01_add_session_auth_audience.sql. Drops the additive column only.

DROP INDEX IF EXISTS sessions_account_audience_active_idx;

ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_auth_audience_chk;

ALTER TABLE sessions DROP COLUMN IF EXISTS auth_audience;
