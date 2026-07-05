-- 040_projects_customer_link.sql
-- Link checklist-api projects to real customers (customer-api owns the
-- customers table) so customer contacts can see their project status
-- through the portal.
--
-- Also adds a `visible_to_customer` toggle so admins can attach modules
-- and take audit notes without leaking WIP to the client until it's ready.
--
-- `client_name` stays as-is — it's a display fallback for early-stage
-- engagements that don't have a customer record yet. When `customer_id`
-- is set, the portal + admin UIs prefer the linked customer's name.
--
-- Next migration: 041_*.sql

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS customer_id         UUID    REFERENCES customers(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS visible_to_customer BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_projects_customer
    ON projects(customer_id) WHERE customer_id IS NOT NULL;

-- Portal-side module toggle so admins can disable the customer-facing
-- Projects tab at will.
INSERT INTO modules (key, area, name_en, name_th, description, enabled, core, sort_order) VALUES
    ('portal.projects', 'portal', 'Projects', 'โปรเจกต์',
     'Read-only project boards for customer contacts',
     true, false, 60)
ON CONFLICT (key) DO NOTHING;
