-- =============================================================
-- 034_fix_i18n_double_nesting.sql
-- Repair i18n JSONB columns that got double-wrapped by re-runs of
-- migration 011.
--
-- The re-run pattern produced values shaped like:
--   {"en": {"en": "…", "th": "…"}, "th": "…"}
-- The inner `->'en'` value is the correctly-shaped original object.
-- Repair by replacing the column with that inner object where the
-- outer "en" is itself an object.
-- =============================================================

-- ----- services -----
UPDATE services SET title         = title         -> 'en' WHERE jsonb_typeof(title         -> 'en') = 'object';
UPDATE services SET short_summary = short_summary -> 'en' WHERE jsonb_typeof(short_summary -> 'en') = 'object';
UPDATE services SET description   = description   -> 'en' WHERE jsonb_typeof(description   -> 'en') = 'object';

-- ----- case_studies -----
UPDATE case_studies SET summary    = summary    -> 'en' WHERE jsonb_typeof(summary    -> 'en') = 'object';
UPDATE case_studies SET challenge  = challenge  -> 'en' WHERE jsonb_typeof(challenge  -> 'en') = 'object';
UPDATE case_studies SET solution   = solution   -> 'en' WHERE jsonb_typeof(solution   -> 'en') = 'object';
UPDATE case_studies SET results    = results    -> 'en' WHERE jsonb_typeof(results    -> 'en') = 'object';
UPDATE case_studies SET quote_text = quote_text -> 'en' WHERE jsonb_typeof(quote_text -> 'en') = 'object';

-- ----- blog_posts -----
UPDATE blog_posts SET title   = title   -> 'en' WHERE jsonb_typeof(title   -> 'en') = 'object';
UPDATE blog_posts SET excerpt = excerpt -> 'en' WHERE jsonb_typeof(excerpt -> 'en') = 'object';
UPDATE blog_posts SET body_md = body_md -> 'en' WHERE jsonb_typeof(body_md -> 'en') = 'object';

-- ----- pages -----
UPDATE pages SET title           = title           -> 'en' WHERE jsonb_typeof(title           -> 'en') = 'object';
UPDATE pages SET body_md         = body_md         -> 'en' WHERE jsonb_typeof(body_md         -> 'en') = 'object';
UPDATE pages SET seo_title       = seo_title       -> 'en' WHERE jsonb_typeof(seo_title       -> 'en') = 'object';
UPDATE pages SET seo_description = seo_description -> 'en' WHERE jsonb_typeof(seo_description -> 'en') = 'object';
