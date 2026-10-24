-- Isolated. Do not apply without authorization.
-- Adds optional structured address details. Does not rewrite snapshots.

ALTER TABLE addresses
  ADD COLUMN IF NOT EXISTS building varchar(64),
  ADD COLUMN IF NOT EXISTS floor varchar(32),
  ADD COLUMN IF NOT EXISTS entrance varchar(64),
  ADD COLUMN IF NOT EXISTS landmark varchar(128);
