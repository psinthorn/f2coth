-- =============================================================
-- 046_client_showcase_consent.sql
-- Consent-driven client showcase on the public site.
--
-- 1) Extends `customers` with brand-approved display fields plus the
--    signed-consent audit trail required by PDPA (มาตรา 24) and by the
--    vendor-confidentiality clauses common in luxury-hotel contracts.
-- 2) Registers module `public.clients` (default OFF) so the `/clients`
--    page and its nav/footer links stay hidden until F2 admin flips it
--    on in `/admin/features` — after consent is collected.
--
-- Public read query pattern (see cms-api handler `ListPublicClients`):
--   WHERE is_active            = TRUE
--     AND show_on_website      = TRUE
--     AND consent_granted_at   IS NOT NULL
--     AND (consent_expires_at IS NULL OR consent_expires_at > NOW())
--   ORDER BY website_sort_order, name;
-- =============================================================

-- ---------- 1. Extend customers with website + consent columns ----------
ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS show_on_website          BOOLEAN     NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS website_display_name     TEXT,
    ADD COLUMN IF NOT EXISTS website_logo_url         TEXT,
    ADD COLUMN IF NOT EXISTS website_industry_label   TEXT,
    ADD COLUMN IF NOT EXISTS website_industry_label_th TEXT,
    ADD COLUMN IF NOT EXISTS website_sort_order       INT         NOT NULL DEFAULT 100,
    ADD COLUMN IF NOT EXISTS consent_document_url     TEXT,
    ADD COLUMN IF NOT EXISTS consent_granted_at       TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS consent_granted_by       TEXT,
    ADD COLUMN IF NOT EXISTS consent_expires_at       TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS consent_notes            TEXT;

-- Guardrail: only rows with a granted-at date may sit in show_on_website=TRUE.
-- Enforced at the DB layer so no future admin form can flip the toggle
-- before consent is recorded. Named constraint so we can drop/re-add cleanly.
ALTER TABLE customers
    DROP CONSTRAINT IF EXISTS customers_showcase_requires_consent;
ALTER TABLE customers
    ADD  CONSTRAINT customers_showcase_requires_consent
    CHECK (show_on_website = FALSE OR consent_granted_at IS NOT NULL);

-- Partial index that matches the public query exactly. Small (only
-- consented customers) and eliminates a filesort on the sort column.
CREATE INDEX IF NOT EXISTS idx_customers_public_showcase
    ON customers (website_sort_order, name)
    WHERE is_active = TRUE
      AND show_on_website = TRUE
      AND consent_granted_at IS NOT NULL;

-- ---------- 2. Register the public.clients module (default OFF) ----------
INSERT INTO modules (key, area, name_en, name_th, description, enabled, core, sort_order)
VALUES (
    'public.clients',
    'public',
    'Clients showcase',
    'ลูกค้าที่เราดูแล',
    'Public directory of consenting managed clients. Only surfaces customers with show_on_website=TRUE and a valid signed-consent record.',
    FALSE,   -- default OFF — F2 admin flips on from /admin/features after consent collection
    FALSE,
    45       -- sits between case_studies (40) and blog (50)
)
ON CONFLICT (key) DO NOTHING;
