-- 069_assethub_asset_groups.sql
-- Workstation groups. Every physical thing (PC, monitor, UPS, keyboard…) stays a
-- first-class asset with its own tag; a "group" is a lightweight bundle on top
-- that links the assets used together as one seat/workstation — e.g. AR1, AP1
-- under the Accounting department = { PC1 + Monitor1 + UPS1 }.

CREATE TABLE IF NOT EXISTS assethub_asset_groups (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    site_id     UUID        REFERENCES assethub_sites(id) ON DELETE SET NULL,
    name        TEXT        NOT NULL,                -- seat/workstation label, e.g. "AR1"
    department  TEXT,                                -- optional grouping, e.g. "Accounting"
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (customer_id, name)
);
CREATE INDEX IF NOT EXISTS idx_assethub_asset_groups_customer ON assethub_asset_groups(customer_id);

-- Which workstation an asset belongs to (nullable — ungrouped assets are fine).
-- ON DELETE SET NULL: deleting a workstation frees its assets, never deletes them.
ALTER TABLE assethub_devices ADD COLUMN IF NOT EXISTS group_id UUID
    REFERENCES assethub_asset_groups(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_assethub_devices_group ON assethub_devices(group_id);

-- Auto-detected peripherals (e.g. monitors read from a PC's EDID) link to the
-- host device that reported them, so assigning the PC to a workstation can carry
-- its monitors along.
ALTER TABLE assethub_devices ADD COLUMN IF NOT EXISTS parent_device_id UUID
    REFERENCES assethub_devices(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_assethub_devices_parent ON assethub_devices(parent_device_id);

-- New peripheral device_types (monitor/ups/keyboard/mouse/dock) reuse the same
-- register; their asset-tag category codes live in the app (assettag.go):
--   monitor 012 · ups 013 · keyboard 014 · mouse 015 · dock 016.
-- Widen the device_type CHECK constraint (from 065) to allow them.
ALTER TABLE assethub_devices DROP CONSTRAINT IF EXISTS assethub_devices_device_type_check;
ALTER TABLE assethub_devices ADD CONSTRAINT assethub_devices_device_type_check
    CHECK (device_type IN ('computer','server','nas','router','switch','ap','printer',
                           'camera','phone','tablet','iot','monitor','ups','keyboard',
                           'mouse','dock','unknown'));
