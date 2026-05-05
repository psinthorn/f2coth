-- =============================================================
-- 007_seed_data.sql
-- Idempotent seed data for dev / staging.
-- =============================================================

-- ----- Admin user (password: F2@admin2026 — change in prod!) -----
-- bcrypt(cost=12) hash of "F2@admin2026". Verified: golang.org/x/crypto/bcrypt.
INSERT INTO users (email, password_hash, full_name, role)
VALUES (
    'admin@f2.co.th',
    '$2a$12$/ykGbVUnctDZ9Lg7.fvEwONZLDjTp2lkByF0.BFwxV7wrHCeDbH5e',
    'F2 Administrator',
    'admin'
)
ON CONFLICT (email) DO NOTHING;

-- ----- 8 service lines -----
INSERT INTO services (slug, title, short_summary, description, icon, category, sort_order)
VALUES
('it-management',
 'IT Management Partner',
 'End-to-end IT operations for hotels, villas, and resorts — single point of contact, hospitality-grade SLAs.',
 'F2 acts as your in-house IT department. We design, deploy, monitor, and support every layer of your property''s technology — from the cabling in the walls to the apps on your guests'' phones. Same-day on-site response on Samui; remote-first elsewhere in Thailand.',
 'Server', 'core', 10),

('digital-transformation',
 'Digital Transformation',
 'Roadmaps and execution to modernise property operations, guest experience, and back-office workflows.',
 'We assess your current stack, identify the highest-ROI changes, and then actually build them. Typical engagements: PMS modernisation, contactless check-in, paperless F&B ops, AI-assisted reservations and revenue management.',
 'Sparkles', 'core', 20),

('ai-driven-solutions',
 'AI-Driven Solutions',
 'Practical AI for hospitality — chat concierge, intelligent enquiry handling, ops copilots.',
 'F2 builds and operates AI workflows that fit your brand voice. Powered by Anthropic Claude and OpenAI, integrated with your PMS, booking engine, and CRM. Outcomes-first, not hype-first.',
 'Bot', 'core', 30),

('domain-hosting',
 'Domain & Hosting',
 'Reliable domain registration and managed hosting via our ResellerClub partnership.',
 'Single-vendor management of your .com, .co.th, and country-specific domains, plus high-uptime managed hosting tuned for hospitality websites and booking engines. DNS, SSL, and email — handled.',
 'Globe', 'core', 40),

('iacc-saas',
 'iACC — Tour Operator SaaS',
 'Multi-tenant accounting and operations platform for tour operators and travel agencies.',
 'iACC is F2''s own SaaS product: bookings, payments, agents, allotments, fleets — all in one place, mobile-friendly, hosted on cPanel-ready infrastructure. Visit iacc.f2.co.th.',
 'LayoutDashboard', 'core', 50),

('it-support-msp',
 'IT Management & MSP Services',
 '24/7 monitoring, helpdesk, and managed services for distributed hospitality operations.',
 'We sit on top of your stack and keep it running. Helpdesk, monitoring, patching, backups, vendor management. Tiered SLAs from business-hours to 24/7 white-glove.',
 'Headset', 'support', 60),

('cybersecurity',
 'Cybersecurity',
 'Firewall, intrusion detection, guest network isolation, CCTV, and PCI-aware POS hardening.',
 'Hospitality is a high-value target. We deploy and operate the security controls your insurers and brand standards expect — without making the guest WiFi feel like an enterprise VPN.',
 'ShieldCheck', 'support', 70),

('hardware-solar',
 'Hardware & Solar (Samui)',
 'IT hardware via SiS Distribution, plus solar cell installation for our Samui clients.',
 'Through our SiS Distribution partnership we source enterprise networking, servers, and POS hardware at distributor pricing. On Koh Samui we also offer turnkey solar installations for resorts looking to cut electricity costs.',
 'Sun', 'opportunistic', 80)
ON CONFLICT (slug) DO NOTHING;

-- ----- 3 case studies (mirrors docs/case-studies/) -----
INSERT INTO case_studies
    (slug, client_name, industry, location, relationship_years, summary,
     challenge, solution, results, services_used, sort_order, is_published, published_at)
VALUES
('sala-hospitality',
 'SALA Hospitality Group',
 'Luxury Hotels & Resorts',
 'Thailand (8 properties)',
 10,
 'A decade of trusted domain and Domain Privacy management across SALA''s 8 luxury properties. Low-touch, high-trust, never-missed.',
 'SALA''s 8 luxury properties — Samui, Phuket, Bangkok, Ayutthaya, Khao Yai — operate as recognisable global brands (Condé Nast, DestinAsian). Eight properties means many domains: primary brand sites, sub-brands, country-specific TLDs, and protected name variants. Award-winning brands need unimpeachable domain hygiene: no expired registrations, no DNS surprises, no exposed registrant data inviting spam or social-engineering.',
 'F2 manages SALA''s complete domain portfolio under our ResellerClub partnership: registration and renewals, DNS hosting and configuration, and Domain Privacy / WhoisGuard on every name to mask registrant details. Consolidated invoicing in Thai Baht. Single point of contact for any domain action — whether it''s a quick A-record change or moving a name between registrars.',
 'Zero domain-related incidents in 10+ years. Every SALA-owned domain shielded by Domain Privacy. No renewal ever missed. Consolidated billing simplifies SALA''s vendor management — one PO covers the entire estate''s domain operations.',
 ARRAY['domain-hosting'],
 10, TRUE, NOW()),

('putahracsa-hua-hin',
 'Putahracsa Hua Hin',
 'Boutique Luxury Resort',
 'Hua Hin, Thailand',
 10,
 'Five Star Alliance boutique resort, 67 rooms, multiple F&B outlets, managed remotely from Bangkok and Samui.',
 'Design-focused boutique hotel where technology must be invisible to guests but reliable for operations. Multiple F&B outlets need integrated POS. Located 200km from Bangkok with limited local IT expertise.',
 'Full IT operations managed remotely from Bangkok/Samui: POS integration across 3 F&B outlets and the spa, property-wide WiFi, Microsoft 365, domain & hosting, and on-site visits as needed. Hardware sourced through SiS.',
 'Seamless operations across all outlets. 10+ years, zero vendor changes. Five Star Alliance standards maintained. Proves F2''s remote-management model works beyond Koh Samui — opening the Hua Hin / Pranburi / Gulf Coast corridor.',
 ARRAY['it-management','domain-hosting','cybersecurity','hardware-solar'],
 20, TRUE, NOW()),

('miskawaan-villas',
 'Miskawaan Beachfront Villas',
 'Ultra-Luxury Private Villas',
 'Maenam Beach, Koh Samui',
 NULL,
 'F2''s newest client. Microsoft 365 administration under a one-year SLA — March 2026 to March 2027 — for the team behind TripAdvisor''s #1 specialty lodging on Koh Samui.',
 'Miskawaan''s growing team needed proper Microsoft 365 administration — user provisioning, mailboxes, security policies, and licence optimisation — handled by an experienced partner rather than as a side-task for in-house staff. As TripAdvisor''s #1 specialty lodging on Koh Samui, an email outage or compromised account would land directly on guest reviews.',
 'F2 took over Microsoft 365 administration under a one-year SLA running March 2026 – March 2027. Scope: tenant administration, full user lifecycle (joiners / movers / leavers), mailbox and shared-resource configuration, conditional access and MFA enforcement, licence optimisation across M365 plans, helpdesk for staff M365 questions, and quarterly compliance reviews. On-call response within SLA.',
 'SLA active from March 2026 to March 2027. Performance against SLA reported quarterly; renewal review scheduled for January 2027.',
 ARRAY['it-support-msp','it-management'],
 30, TRUE, NOW())
ON CONFLICT (slug) DO NOTHING;

-- ----- Generic CMS pages -----
INSERT INTO pages (slug, title, body_md, seo_title, seo_description)
VALUES
('about',
 'About F2 Co., Ltd.',
 E'## Thailand''s trusted IT partner for luxury hospitality\n\nF2 Co., Ltd. (formerly Nextgentechs Service & Support Co., Ltd.) is a Thai IT services company headquartered in Bangkok with a branch on Koh Samui. For over a decade we have served luxury hotels, villas, and resorts across Thailand — including SALA Hospitality, Miskawaan Beach Villas, and Putahracsa Hua Hin.\n\nWe are a registered and trusted IT service provider in the hospitality industry, with deep partnerships with ResellerClub (domains & hosting), SiS Distribution (hardware), and Microsoft.',
 'About F2 Co., Ltd. — Hospitality IT in Thailand',
 'F2 Co., Ltd. is Thailand''s trusted IT partner for luxury hospitality, with offices in Bangkok and Koh Samui and 10+ year client relationships.'),
('privacy',
 'Privacy Policy',
 E'F2 Co., Ltd. respects your privacy. This page describes what data we collect from visitors to f2.co.th and how we use it.\n\nWe collect contact form submissions, anonymous analytics, and chatbot conversation transcripts solely for the purpose of responding to enquiries and improving our service.',
 'Privacy Policy — F2 Co., Ltd.',
 'How F2 Co., Ltd. collects, uses, and protects visitor data on f2.co.th.'),
('terms',
 'Terms of Service',
 E'These terms govern your use of f2.co.th. By using this site you agree to use it lawfully and not to attempt to disrupt, reverse engineer, or compromise the service.',
 'Terms of Service — F2 Co., Ltd.',
 'Terms of service for f2.co.th.')
ON CONFLICT (slug) DO NOTHING;

-- ----- Notification templates -----
INSERT INTO notification_templates (code, subject_tmpl, body_tmpl, description)
VALUES
('lead_received_sales',
 'New lead: {{full_name}} ({{property_name}})',
 E'A new lead has come in via {{source}}.\n\nName: {{full_name}}\nEmail: {{email}}\nPhone: {{phone}}\nCompany: {{company}}\nProperty: {{property_name}} ({{property_type}})\nInterest: {{interest}}\n\nMessage:\n{{message}}\n\n— f2.co.th',
 'Internal alert to sales when a new lead is captured.'),
('lead_received_visitor',
 'Thank you for contacting F2 Co., Ltd.',
 E'Hi {{full_name}},\n\nThank you for reaching out to F2 Co., Ltd. We''ve received your enquiry and a member of our team will be in touch within one business day.\n\nIn the meantime, you can read our case studies at https://f2.co.th/case-studies.\n\n— The F2 Team',
 'Auto-acknowledgement to the visitor who submitted the form.')
ON CONFLICT (code) DO NOTHING;
