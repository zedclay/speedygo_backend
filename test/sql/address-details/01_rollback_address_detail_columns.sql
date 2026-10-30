-- Isolated rollback. Does not touch address_text or order snapshots.

ALTER TABLE addresses
  DROP COLUMN IF EXISTS building,
  DROP COLUMN IF EXISTS floor,
  DROP COLUMN IF EXISTS entrance,
  DROP COLUMN IF EXISTS landmark;
