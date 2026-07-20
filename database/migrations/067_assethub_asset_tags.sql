-- 067_assethub_asset_tags.sql
-- Default asset-tag scheme:  PREFIX-CCC-SSS-NNN   e.g.  DPV-001-002-001
--   PREFIX = per-client code   CCC = category (device type)
--   SSS    = sub-type          NNN = running number, per (org, category)

-- Per-client prefix. Backfill a derived code (first 4 alnum of slug, upper);
-- editable later. Falls back to 'F2' when a customer has no usable slug/name.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS asset_tag_prefix TEXT;
UPDATE customers
   SET asset_tag_prefix = COALESCE(
         NULLIF(UPPER(LEFT(REGEXP_REPLACE(COALESCE(slug, name), '[^A-Za-z0-9]', '', 'g'), 4)), ''),
         'F2')
 WHERE asset_tag_prefix IS NULL OR asset_tag_prefix = '';

-- Atomic running number per (organization, category code). We never reuse a
-- number after a delete, so tags stay stable and unique within a category.
CREATE TABLE IF NOT EXISTS assethub_asset_seq (
    customer_id   UUID    NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    category_code TEXT    NOT NULL,
    next_val      INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (customer_id, category_code)
);
