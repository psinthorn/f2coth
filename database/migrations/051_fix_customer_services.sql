-- =============================================================
-- 051_fix_customer_services.sql
-- Data-only fix flagged by an MCP audit of customers.services_used:
--
--   1) Miskawaan Beachfront Villas contained a typo string
--      'Iit-system-audit' (extra i, capital I) that doesn't match any
--      slug in the services catalogue. The customer's notes column
--      already says "Microsoft 365 administration under one-year SLA" —
--      so the intended slug was almost certainly `microsoft-365`
--      (added in migration 048). Replace the typo, keep the two valid
--      slugs.
--
--   2) My Samui Island Tour Co.,Ltd. had services_used = '{}'. Their
--      business is a tour operator; F2's own iACC-SaaS product
--      (services.slug = 'iacc-saas') is the tour-operator platform we
--      run for exactly this class of client. Tag them accordingly so
--      /admin/customers filters + AI queries surface them.
-- =============================================================

-- 1. Miskawaan — remove typo, add microsoft-365.
UPDATE customers
   SET services_used = ARRAY['it-support-msp','it-management','microsoft-365']
 WHERE slug = 'miskawaan-villas';

-- 2. My Samui Island Tour — tag with iacc-saas.
UPDATE customers
   SET services_used = ARRAY['iacc-saas']
 WHERE slug = 'my-samui-island-tour'
   AND cardinality(services_used) = 0;
