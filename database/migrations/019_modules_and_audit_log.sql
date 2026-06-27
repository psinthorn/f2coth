-- 019_modules_and_audit_log.sql
-- Foundation for the module-toggle architecture (memories/feature_module_toggle_architecture.md)
-- plus a generic cross-resource audit_log that replaces the per-resource
-- dsr_audit_log introduced in 018 (consolidated per the reuse mandate).
--
--   1. modules               — every public/portal/admin/api feature with an enabled flag
--                              and a `core` flag for non-toggleable items
--   2. audit_log             — generic actor/action/changes log keyed by
--                              (resource_type, resource_id) so any resource
--                              (dsr, module, user, …) can write into it
--   3. data migration        — copy existing dsr_audit_log rows into audit_log
--                              with resource_type='dsr', then drop the old table
--
-- The Go code in services/auth-api/internal/handlers/privacy.go is updated
-- in the same change to insert into audit_log (see writeAuditEntry).
--
-- Next migration: 020_*.sql

-- ─────────────────────────────────────────────
-- 1. modules — module toggle registry
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS modules (
    key          TEXT        PRIMARY KEY,
    area         TEXT        NOT NULL CHECK (area IN ('public', 'portal', 'admin', 'api')),
    name_en      TEXT        NOT NULL,
    name_th      TEXT        NOT NULL,
    description  TEXT,
    enabled      BOOLEAN     NOT NULL DEFAULT false,
    -- core modules cannot be toggled off from the admin UI (login, home,
    -- contact, etc.); enforced in the API layer, not the DB.
    core         BOOLEAN     NOT NULL DEFAULT false,
    sort_order   INT         NOT NULL DEFAULT 0,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by   UUID        REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_modules_area ON modules (area, sort_order);
CREATE INDEX IF NOT EXISTS idx_modules_enabled ON modules (enabled);

CREATE OR REPLACE TRIGGER set_modules_updated_at
    BEFORE UPDATE ON modules
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────
-- 2. audit_log — generic cross-resource trail
-- ─────────────────────────────────────────────
--   resource_id is TEXT (not UUID) so it can store keys from heterogeneous
--   resources: modules use TEXT keys ('public.blog'), dsr uses UUID, …
CREATE TABLE IF NOT EXISTS audit_log (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_type TEXT        NOT NULL,
    resource_id   TEXT        NOT NULL,
    actor_id      UUID        REFERENCES users(id) ON DELETE SET NULL,
    actor_email   TEXT,
    action        TEXT        NOT NULL,
    changes       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_resource
    ON audit_log (resource_type, resource_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor
    ON audit_log (actor_id, at DESC) WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_at
    ON audit_log (at DESC);

-- ─────────────────────────────────────────────
-- 3. Migrate dsr_audit_log → audit_log, then drop the old table
-- ─────────────────────────────────────────────
INSERT INTO audit_log (id, resource_type, resource_id, actor_id, actor_email, action, changes, at)
SELECT id, 'dsr', dsr_id::text, actor_id, actor_email, action, changes, at
  FROM dsr_audit_log
 ON CONFLICT (id) DO NOTHING;

DROP TABLE IF EXISTS dsr_audit_log;

-- ─────────────────────────────────────────────
-- 4. Seed module rows for every currently-shipped feature
--    enabled=true so nothing disappears on day one;
--    core=true for items that must never be toggled off.
-- ─────────────────────────────────────────────
INSERT INTO modules (key, area, name_en, name_th, description, enabled, core, sort_order) VALUES
-- Public site (12)
('public.home',         'public', 'Home',                       'หน้าแรก',                    'Marketing landing page',                       true, true,  10),
('public.about',        'public', 'About',                      'เกี่ยวกับเรา',              'Company introduction',                          true, false, 20),
('public.services',     'public', 'Services',                   'บริการ',                    'Service catalogue and detail pages',            true, false, 30),
('public.case_studies', 'public', 'Case studies',               'กรณีศึกษา',                 'Hospitality case studies',                      true, false, 40),
('public.blog',         'public', 'Blog',                       'บล็อก',                     'Blog list and post detail',                     true, false, 50),
('public.products',     'public', 'Products',                   'สินค้า',                    'Product showcase',                              true, false, 60),
('public.domains',      'public', 'Domains',                    'โดเมน',                     'Domain marketplace',                            true, false, 70),
('public.hosting',      'public', 'Hosting',                    'โฮสติ้ง',                   'Hosting plans',                                 true, false, 80),
('public.contact',      'public', 'Contact',                    'ติดต่อ',                    'Contact form',                                  true, true,  90),
('public.terms',        'public', 'Terms of service',           'ข้อกำหนดการใช้บริการ',      'Legal — terms',                                 true, true,  100),
('public.privacy',      'public', 'Privacy & DSR',              'ความเป็นส่วนตัวและ DSR',    'PDPA privacy policy + DSR form + confirm page', true, true,  110),
('public.dpa',          'public', 'Data Processor Agreement',   'ข้อตกลงประมวลผลข้อมูล',     'DPA template page',                             true, false, 120),
-- Customer portal (5)
('portal.login',        'portal', 'Login',                      'เข้าสู่ระบบ',               'Customer portal sign-in',                       true, true,  10),
('portal.dashboard',    'portal', 'Dashboard',                  'แดชบอร์ด',                  'Portal home',                                   true, true,  20),
('portal.tickets',      'portal', 'Tickets',                    'ตั๋วซัพพอร์ต',              'Tickets list / new / detail',                   true, false, 30),
('portal.domains',      'portal', 'Domains',                    'โดเมน',                     'Domain list and ordering',                      true, false, 40),
('portal.sla',          'portal', 'SLA contracts',              'สัญญา SLA',                 'SLA contract view',                             true, false, 50),
-- Admin console (11)
('admin.login',         'admin',  'Login',                      'เข้าสู่ระบบ',               'Admin sign-in',                                 true, true,  10),
('admin.dashboard',     'admin',  'Dashboard',                  'แดชบอร์ด',                  'Admin home with stats',                         true, true,  20),
('admin.leads',         'admin',  'Leads',                      'ลีด',                       'Lead queue and detail',                         true, false, 30),
('admin.tickets',       'admin',  'Tickets',                    'ตั๋วซัพพอร์ต',              'Ticket queue and detail',                       true, false, 40),
('admin.customers',     'admin',  'Customers',                  'ลูกค้า',                    'Customer list and detail',                      true, false, 50),
('admin.orders_domains','admin',  'Domain orders',              'คำสั่งซื้อโดเมน',           'Domain order queue and detail',                 true, false, 60),
('admin.blog',          'admin',  'Blog editor',                'แก้ไขบทความ',               'Blog post management',                          true, false, 70),
('admin.dsr',           'admin',  'DSR queue',                  'คิว DSR',                   'PDPA Data Subject Request queue',               true, false, 80),
('admin.pricing',       'admin',  'Pricing',                    'ราคาและแพ็คเกจ',            'Domain + hosting pricing management',            true, false, 90),
('admin.users',         'admin',  'Users',                      'ผู้ใช้',                    'Admin user management',                         true, true,  100),
('admin.features',      'admin',  'Feature inventory',          'รายการฟีเจอร์',             'Module toggle UI (this page)',                  true, true,  110),
-- APIs (9). Backend gating is Phase 7 — for now these are visible in the
-- admin UI but not enforced. Core for groups that the platform cannot run without.
('api.auth',            'api',    'Authentication API',         'API ยืนยันตัวตน',           'Login, refresh, logout',                         true, true,  10),
('api.consent',         'api',    'Cookie consent API',         'API ความยินยอม cookie',     'PDPA cookie consent endpoints',                  true, false, 20),
('api.leads',           'api',    'Leads API',                  'API ลีด',                   'Lead submission + admin CRUD',                   true, false, 30),
('api.dsr',             'api',    'DSR API',                    'API DSR',                   'DSR submit/verify/admin (PDPA)',                  true, false, 40),
('api.cms',             'api',    'CMS API',                    'API CMS',                   'Services, blog, case studies, pricing',          true, false, 50),
('api.chat',            'api',    'AI chatbot API',             'API แชทบอท AI',             'Claude-powered chat',                            true, false, 60),
('api.notifications',   'api',    'Notification API',           'API การแจ้งเตือน',          'Email worker',                                   true, false, 70),
('api.reseller',        'api',    'Reseller API',               'API ตัวแทนจำหน่าย',         'Domain availability + ordering',                 true, false, 80),
('api.portal',          'api',    'Portal API',                 'API พอร์ทัล',               'Customer portal endpoints',                      true, true,  90)
ON CONFLICT (key) DO NOTHING;
