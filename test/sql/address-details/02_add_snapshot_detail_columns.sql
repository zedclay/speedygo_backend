-- Isolated. Do not apply without authorization.
-- Adds optional structured details on the immutable order snapshot.
-- Does not rewrite existing snapshot rows or address_text.

ALTER TABLE order_delivery_address_snapshots
  ADD COLUMN IF NOT EXISTS building varchar(64),
  ADD COLUMN IF NOT EXISTS floor varchar(32),
  ADD COLUMN IF NOT EXISTS entrance varchar(64),
  ADD COLUMN IF NOT EXISTS landmark varchar(128);
