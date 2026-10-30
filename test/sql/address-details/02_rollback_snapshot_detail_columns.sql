-- Isolated rollback. Drops snapshot detail columns.
-- Does not touch address_text, live addresses, or historical instructions.
-- Prefer the data-preserving disable (hide API fields) when saved details exist.

ALTER TABLE order_delivery_address_snapshots
  DROP COLUMN IF EXISTS building,
  DROP COLUMN IF EXISTS floor,
  DROP COLUMN IF EXISTS entrance,
  DROP COLUMN IF EXISTS landmark;
