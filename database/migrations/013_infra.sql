-- =============================================================
-- 013_infra.sql
-- Phase 4A — Infrastructure section: domain pricing (THNIC + ResellerClub),
-- hosting plans, two new service lines (Cloud/VPS, DevOps/CI/CD), and the
-- About-page partnership refresh.
-- =============================================================

-- ---------- Allow new lead sources ----------
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_source_check;
ALTER TABLE leads ADD CONSTRAINT leads_source_check
    CHECK (source IN (
        'contact_form','services_page','case_study','iacc_demo',
        'chatbot','referral','domain_search','hosting_request','other'
    ));

-- ---------- domain_pricing ----------
CREATE TABLE IF NOT EXISTS domain_pricing (
    id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tld                  TEXT         NOT NULL UNIQUE,
    registry             TEXT         NOT NULL CHECK (registry IN ('thnic','resellerclub')),
    register_price_thb   INTEGER      NOT NULL CHECK (register_price_thb >= 0),
    renew_price_thb      INTEGER      NOT NULL CHECK (renew_price_thb >= 0),
    transfer_price_thb   INTEGER      NOT NULL CHECK (transfer_price_thb >= 0),
    privacy_included     BOOLEAN      NOT NULL DEFAULT FALSE,
    is_thai_only         BOOLEAN      NOT NULL DEFAULT FALSE,
    notes                JSONB        NOT NULL DEFAULT '{}'::jsonb,
    sort_order           INTEGER      NOT NULL DEFAULT 0,
    is_active            BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_domain_pricing_active   ON domain_pricing(is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_domain_pricing_registry ON domain_pricing(registry);

CREATE TRIGGER trg_domain_pricing_updated_at
BEFORE UPDATE ON domain_pricing
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- hosting_plans ----------
CREATE TABLE IF NOT EXISTS hosting_plans (
    id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                 TEXT         NOT NULL UNIQUE,
    name                 JSONB        NOT NULL DEFAULT '{}'::jsonb,
    tagline              JSONB        NOT NULL DEFAULT '{}'::jsonb,
    price_thb_monthly    INTEGER      NOT NULL CHECK (price_thb_monthly >= 0),
    price_thb_annually   INTEGER      NOT NULL CHECK (price_thb_annually >= 0),
    storage_gb           INTEGER      NOT NULL,
    sites_included       INTEGER      NOT NULL DEFAULT 1,         -- 0 = unlimited
    emails_included      INTEGER      NOT NULL DEFAULT 5,         -- 0 = unlimited
    bandwidth_label      JSONB        NOT NULL DEFAULT '{}'::jsonb,
    ssl_included         BOOLEAN      NOT NULL DEFAULT TRUE,
    daily_backups        BOOLEAN      NOT NULL DEFAULT FALSE,
    perks                JSONB        NOT NULL DEFAULT '{}'::jsonb, -- { en: [...], th: [...] }
    is_featured          BOOLEAN      NOT NULL DEFAULT FALSE,
    sort_order           INTEGER      NOT NULL DEFAULT 0,
    is_published         BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT hosting_name_has_en CHECK (name ? 'en')
);

CREATE INDEX IF NOT EXISTS idx_hosting_plans_published ON hosting_plans(is_published, sort_order);

CREATE TRIGGER trg_hosting_plans_updated_at
BEFORE UPDATE ON hosting_plans
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- Two new service rows ----------
INSERT INTO services (slug, title, short_summary, description, icon, category, sort_order)
VALUES
('cloud-infrastructure',
 jsonb_build_object(
   'en', 'Cloud & VPS',
   'th', 'คลาวด์และ VPS'),
 jsonb_build_object(
   'en', 'Managed DigitalOcean infrastructure — we set it up, you decide whether to run it or have us run it for you.',
   'th', 'บริหารจัดการโครงสร้างพื้นฐาน DigitalOcean — F2 ตั้งค่าให้ คุณเลือกได้ว่าจะดูแลเองหรือให้เราดูแลต่อเนื่อง'),
 jsonb_build_object(
   'en', 'F2 is a DigitalOcean partner. We design and deploy your droplets, managed databases, load balancers, object storage, and automated backups — then you choose the engagement model. One-shot setup hands you a documented production environment to run yourself. Managed ops keeps F2 on call: patches, monitoring, capacity planning, incident response. Pricing is engagement-based, starting from a one-day setup for small workloads to multi-region clusters for resort groups running their own PMS infrastructure.',
   'th', 'F2 เป็นพาร์ทเนอร์ของ DigitalOcean เราออกแบบและติดตั้งระบบ droplets, managed databases, load balancers, object storage และระบบสำรองข้อมูลอัตโนมัติให้คุณ — แล้วคุณเลือกรูปแบบการดูแล: ตั้งค่าครั้งเดียวพร้อมเอกสารส่งมอบให้คุณดูแลเอง หรือให้ F2 ดูแลต่อเนื่อง patch, monitoring, วางแผน capacity, ตอบสนองเหตุการณ์ ราคาเป็นแบบ project-based เริ่มจากการตั้งค่าหนึ่งวันสำหรับงานขนาดเล็ก ไปจนถึง cluster หลายภูมิภาคสำหรับเครือโรงแรมที่รัน PMS ของตนเอง'),
 'Cloud', 'core', 35)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO services (slug, title, short_summary, description, icon, category, sort_order)
VALUES
('devops-cicd',
 jsonb_build_object(
   'en', 'DevOps & CI/CD',
   'th', 'DevOps และ CI/CD'),
 jsonb_build_object(
   'en', 'GitHub Actions pipelines, Infrastructure-as-Code, containerised deployments — F2 sets up, supports, evolves.',
   'th', 'pipeline GitHub Actions, Infrastructure-as-Code, การ deploy ผ่าน container — F2 ตั้งค่า ดูแล และพัฒนาต่อเนื่อง'),
 jsonb_build_object(
   'en', 'F2 builds the build-test-deploy pipelines that take your team from "edit-and-FTP" to "merge-to-main and prod is updated." We start with GitHub Actions for CI/CD, layer Terraform or Pulumi for Infrastructure-as-Code, and add Docker / Kubernetes when the workload calls for it. Engagements range from a single-repo setup for boutique operators to multi-environment release flows for tour-operator SaaS. Output: documented pipelines your team can reason about, plus optional ongoing support.',
   'th', 'F2 สร้าง pipeline build-test-deploy ที่นำทีมของคุณจาก "แก้ไขและ FTP" สู่ "merge เข้า main แล้ว production อัปเดตทันที" เราเริ่มด้วย GitHub Actions สำหรับ CI/CD เพิ่ม Terraform หรือ Pulumi สำหรับ Infrastructure-as-Code และเสริม Docker / Kubernetes เมื่อ workload ต้องการ ขอบเขตงานตั้งแต่การตั้งค่า repo เดียวสำหรับโรงแรมขนาดเล็ก ไปจนถึง release flow หลาย environment สำหรับ SaaS ของ tour operator ผลลัพธ์: pipeline ที่ทีมของคุณเข้าใจและจัดการได้พร้อมเอกสาร และสามารถเลือกให้ F2 ดูแลต่อเนื่องได้'),
 'GitBranch', 'core', 36)
ON CONFLICT (slug) DO NOTHING;

-- ---------- Seed: domain pricing ----------
INSERT INTO domain_pricing (tld, registry, register_price_thb, renew_price_thb, transfer_price_thb,
                            privacy_included, is_thai_only, notes, sort_order)
VALUES
-- THNIC (Thai ccTLDs) — F2 is a direct THNIC reseller
('co.th',  'thnic',        890,  890,  890,  FALSE, TRUE,
 jsonb_build_object('en','For Thai-registered businesses. Requires DBD certificate.',
                    'th','สำหรับนิติบุคคลไทย ต้องมีหนังสือรับรอง DBD'),
 10),
('or.th',  'thnic',        890,  890,  890,  FALSE, TRUE,
 jsonb_build_object('en','For non-profit organisations registered in Thailand.',
                    'th','สำหรับองค์กรไม่แสวงหากำไรในประเทศไทย'),
 20),
('in.th',  'thnic',        890,  890,  890,  FALSE, TRUE,
 jsonb_build_object('en','For Thai citizens — individual registrations.',
                    'th','สำหรับบุคคลธรรมดาสัญชาติไทย'),
 30),

-- ResellerClub (international gTLDs) — privacy included free with every reg
('com',    'resellerclub', 420,  450,  420,  TRUE,  FALSE,
 jsonb_build_object('en','The world standard. Domain Privacy free with every registration.',
                    'th','มาตรฐานสากล รวม Domain Privacy ฟรีทุกการจดทะเบียน'),
 110),
('net',    'resellerclub', 520,  520,  520,  TRUE,  FALSE,
 jsonb_build_object('en','Tech and infrastructure brands. Privacy included.',
                    'th','สำหรับแบรนด์ด้านเทคโนโลยีและโครงสร้างพื้นฐาน รวม Privacy'),
 120),
('org',    'resellerclub', 520,  520,  520,  TRUE,  FALSE,
 jsonb_build_object('en','Communities and organisations. Privacy included.',
                    'th','สำหรับชุมชนและองค์กร รวม Privacy'),
 130),
('asia',   'resellerclub', 720,  720,  720,  TRUE,  FALSE,
 jsonb_build_object('en','Regional brands. Privacy included.',
                    'th','สำหรับแบรนด์ระดับภูมิภาค รวม Privacy'),
 140),
('biz',    'resellerclub', 620,  620,  620,  TRUE,  FALSE,
 jsonb_build_object('en','Commercial alternative to .com. Privacy included.',
                    'th','ทางเลือกเชิงพาณิชย์แทน .com รวม Privacy'),
 150)
ON CONFLICT (tld) DO NOTHING;

-- ---------- Seed: hosting plans ----------
INSERT INTO hosting_plans
    (slug, name, tagline, price_thb_monthly, price_thb_annually,
     storage_gb, sites_included, emails_included, bandwidth_label,
     ssl_included, daily_backups, perks, is_featured, sort_order)
VALUES
('starter',
 jsonb_build_object('en','Starter','th','สตาร์ทเตอร์'),
 jsonb_build_object(
   'en','Single-site hosting for a brand microsite or new property page.',
   'th','โฮสติ้งสำหรับเว็บไซต์เดียว เหมาะกับไมโครไซต์แบรนด์หรือเพจอสังหาริมทรัพย์ใหม่'),
 299, 2990,
 5, 1, 5,
 jsonb_build_object('en','100 GB monthly','th','100 GB ต่อเดือน'),
 TRUE, FALSE,
 jsonb_build_object(
   'en', ARRAY['Free SSL on every site','PHP 8.x + MySQL','Daily F2 health monitoring','Email support, business hours (Asia/Bangkok)'],
   'th', ARRAY['SSL ฟรีทุกเว็บไซต์','PHP 8.x + MySQL','ตรวจสอบสถานะรายวันโดย F2','ซัพพอร์ตทางอีเมล วันเวลาทำการ (เวลาประเทศไทย)']),
 FALSE, 10),

('professional',
 jsonb_build_object('en','Professional','th','โปรเฟสชันแนล'),
 jsonb_build_object(
   'en','For boutique groups running multiple properties on one CMS.',
   'th','สำหรับกลุ่มโรงแรมบูทีคที่มีหลายอสังหาริมทรัพย์บน CMS เดียว'),
 599, 5990,
 25, 5, 50,
 jsonb_build_object('en','500 GB monthly','th','500 GB ต่อเดือน'),
 TRUE, TRUE,
 jsonb_build_object(
   'en', ARRAY['Free SSL on every site','PHP 8.x + MySQL','Daily F2-managed backups','WordPress / Joomla optimised','Email support with 8-hour SLA'],
   'th', ARRAY['SSL ฟรีทุกเว็บไซต์','PHP 8.x + MySQL','สำรองข้อมูลรายวันโดย F2','ปรับให้เหมาะกับ WordPress / Joomla','ซัพพอร์ตทางอีเมลพร้อม SLA 8 ชั่วโมง']),
 TRUE, 20),

('resort',
 jsonb_build_object('en','Resort','th','รีสอร์ท'),
 jsonb_build_object(
   'en','Unlimited sites and email — for SALA-scale property groups.',
   'th','เว็บไซต์และอีเมลไม่จำกัด — สำหรับเครือโรงแรมระดับ SALA'),
 1499, 14990,
 100, 0, 0,
 jsonb_build_object('en','Unmetered','th','ไม่จำกัด'),
 TRUE, TRUE,
 jsonb_build_object(
   'en', ARRAY['Unlimited sites and mailboxes','Free SSL on every site','Daily F2-managed backups','Priority support, 4-hour SLA','Quarterly performance review with F2'],
   'th', ARRAY['เว็บไซต์และกล่องจดหมายไม่จำกัด','SSL ฟรีทุกเว็บไซต์','สำรองข้อมูลรายวันโดย F2','ซัพพอร์ตลำดับความสำคัญสูง SLA 4 ชั่วโมง','ทบทวนผลการดำเนินงานรายไตรมาสกับ F2']),
 FALSE, 30)
ON CONFLICT (slug) DO NOTHING;

-- ---------- About-page partnerships refresh ----------
-- Append THNIC and DigitalOcean to the partnerships paragraph in both locales.
UPDATE pages SET body_md = body_md || jsonb_build_object('en',
    E'## Thailand''s trusted IT partner for luxury hospitality\n\nF2 Co., Ltd. (formerly Nextgentechs Service & Support Co., Ltd.) is a Thai IT services company headquartered in Bangkok with a branch on Koh Samui. For over a decade we have served luxury hotels, villas, and resorts across Thailand — including SALA Hospitality, Miskawaan Beach Villas, and Putahracsa Hua Hin.\n\nWe are a registered and trusted IT service provider in the hospitality industry, with deep partnerships with **ResellerClub** (gTLDs & hosting), **THNIC** (Thai ccTLDs — `.co.th`, `.or.th`, `.in.th`), **DigitalOcean** (managed cloud), **SiS Distribution** (hardware), and **Microsoft** (provider services).')
WHERE slug = 'about';

UPDATE pages SET body_md = body_md || jsonb_build_object('th',
    E'## พันธมิตรไอทีที่โรงแรมหรูในไทยไว้วางใจ\n\nF2 Co., Ltd. (เดิมชื่อ Nextgentechs Service & Support Co., Ltd.) เป็นบริษัทบริการไอทีของไทย มีสำนักงานใหญ่ในกรุงเทพและสาขาที่เกาะสมุย กว่าทศวรรษที่ผ่านมา เราดูแลโรงแรม วิลล่า และรีสอร์ทหรูทั่วประเทศไทย — รวมถึง SALA Hospitality, Miskawaan Beach Villas และ Putahracsa Hua Hin\n\nเราเป็นผู้ให้บริการไอทีที่จดทะเบียนและได้รับความไว้วางใจในวงการโรงแรมไทย พร้อมพาร์ทเนอร์ที่แน่นแฟ้นกับ **ResellerClub** (gTLDs และโฮสติ้ง), **THNIC** (โดเมน .co.th, .or.th, .in.th), **DigitalOcean** (managed cloud), **SiS Distribution** (ฮาร์ดแวร์) และ **Microsoft** (provider services)')
WHERE slug = 'about';
