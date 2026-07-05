-- 053_attachments.sql
-- Generic file attachments for tickets and projects.
--
-- Adds multi-document / multi-image upload plus geo-tagged "live photos"
-- (device camera + GPS) to four surfaces: portal tickets, admin tickets,
-- project checklists, and individual thread messages. One polymorphic
-- table backs them all — the concept of "an attached file" lives once.
--
-- Storage: BYTEA inline, mirroring payment_slip_files (026). Same rationale
--   1. Volumes are small (an IT shop, not a photo host).
--   2. Attachments are audit evidence — atomic with their owner row.
--   3. Single-region, no CDN to optimise for.
-- Per-file size is capped at 10 MB by both the app layer and this CHECK.
--
-- owner_type + owner_id is a soft polymorphic reference (no FK — the owner
-- rows live in different services/tables: tickets & ticket_messages in
-- customer-api, projects/project_items/visit_logs in checklist-api). The
-- owning handler verifies existence + authorisation before insert.
--
-- Geo columns are populated client-side via navigator.geolocation at
-- capture time (not server EXIF). Rendered as a keyless Google Maps link:
--   https://www.google.com/maps?q=<latitude>,<longitude>
--
-- Next migration: 054_*.sql

BEGIN;

CREATE TABLE IF NOT EXISTS attachments (
    id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_type             TEXT         NOT NULL
                                        CHECK (owner_type IN ('ticket','ticket_message','project','project_item','visit_log')),
    owner_id               UUID         NOT NULL,
    kind                   TEXT         NOT NULL DEFAULT 'document'
                                        CHECK (kind IN ('document','image','live_photo')),
    filename               TEXT         NOT NULL,
    mime_type              TEXT         NOT NULL,
    size_bytes             INT          NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
    sha256                 TEXT,
    content                BYTEA        NOT NULL,

    -- Geo markup for live photos (nullable — documents/images may omit).
    latitude               DOUBLE PRECISION,
    longitude              DOUBLE PRECISION,
    accuracy_m             DOUBLE PRECISION,
    captured_at            TIMESTAMPTZ,

    -- Exactly one uploader kind (staff user OR customer contact).
    uploaded_by_user_id    UUID         REFERENCES users(id) ON DELETE SET NULL,
    uploaded_by_contact_id UUID         REFERENCES customer_contacts(id) ON DELETE SET NULL,

    created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CHECK ((uploaded_by_user_id IS NOT NULL) <> (uploaded_by_contact_id IS NOT NULL)),
    -- Geo columns come as a set: either both lat+lng present or neither.
    CHECK ((latitude IS NULL) = (longitude IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_attachments_owner
    ON attachments (owner_type, owner_id, created_at DESC);

-- Admin on/off toggle (surfaces automatically in /admin/features, which
-- reads the modules table live).
INSERT INTO modules (key, area, name_en, name_th, description, enabled, core, sort_order) VALUES
    ('api.attachments', 'api', 'Attachments', 'ไฟล์แนบ',
     'Document, image and geo-tagged live-photo uploads on tickets and projects',
     true, false, 90)
ON CONFLICT (key) DO NOTHING;

COMMIT;
