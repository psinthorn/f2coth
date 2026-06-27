-- 020_remove_bangkok_office.sql
-- F2 has closed its Bangkok office. Only the Koh Samui HQ remains.
-- The website code (i18n + ai-chat-api system prompt + sitemap +
-- schema.tsx F2_ORG) has been updated in the same change; this migration
-- brings the seeded content rows in line so users browsing live data
-- don't see stale "Bangkok HQ / Koh Samui branch" copy.
--
-- All target columns are JSONB { en, th }; only the EN strings carried
-- Bangkok-office wording, so the TH halves are left alone.
--
-- Idempotent: each UPDATE uses a WHERE that matches the exact stale
-- phrase, so re-running this migration after a manual hot-fix is safe.
--
-- Next migration: 021_*.sql

BEGIN;

-- ---- 1. Putahracsa case study (JSONB columns) ----
UPDATE case_studies
   SET summary = jsonb_set(
         summary, '{en}',
         to_jsonb(REPLACE(
           summary->>'en',
           'managed remotely from Bangkok and Samui',
           'managed remotely from F2''s Koh Samui base'
         ))
       )
 WHERE slug = 'putahracsa-hua-hin'
   AND summary ? 'en'
   AND summary->>'en' LIKE '%Bangkok and Samui%';

UPDATE case_studies
   SET challenge = jsonb_set(
         challenge, '{en}',
         to_jsonb(REPLACE(
           challenge->>'en',
           'Located 200km from Bangkok with limited local IT expertise.',
           'Geographically distant from Thailand''s main IT-services market, requiring a partner that operates effectively without a local on-site office.'
         ))
       )
 WHERE slug = 'putahracsa-hua-hin'
   AND challenge ? 'en'
   AND challenge->>'en' LIKE '%200km from Bangkok%';

UPDATE case_studies
   SET solution = jsonb_set(
         solution, '{en}',
         to_jsonb(REPLACE(
           solution->>'en',
           'managed remotely from Bangkok/Samui',
           'managed remotely from F2''s Koh Samui base'
         ))
       )
 WHERE slug = 'putahracsa-hua-hin'
   AND solution ? 'en'
   AND solution->>'en' LIKE '%Bangkok/Samui%';

-- ---- 2. + 3. CMS page (about) — body + meta description ----
UPDATE pages
   SET body_md = jsonb_set(
         body_md, '{en}',
         to_jsonb(REPLACE(
           body_md->>'en',
           'a Thai IT services company headquartered in Bangkok with a branch on Koh Samui',
           'a Thai IT services company headquartered on Koh Samui (Bophut, Surat Thani) serving luxury properties nationwide'
         ))
       )
 WHERE slug = 'about'
   AND body_md ? 'en'
   AND body_md->>'en' LIKE '%headquartered in Bangkok with a branch%';

UPDATE pages
   SET seo_description = jsonb_set(
         seo_description, '{en}',
         to_jsonb(REPLACE(
           seo_description->>'en',
           'with offices in Bangkok and Koh Samui',
           'headquartered on Koh Samui'
         ))
       )
 WHERE slug = 'about'
   AND seo_description ? 'en'
   AND seo_description->>'en' LIKE '%offices in Bangkok and Koh Samui%';

COMMIT;
