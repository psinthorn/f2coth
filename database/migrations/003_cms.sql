-- =============================================================
-- 003_cms.sql
-- CMS content: services offered, case studies, blog posts,
-- generic CMS pages, and media.
-- =============================================================

-- ----- Service catalogue (the 8 service lines on /services) -----
CREATE TABLE IF NOT EXISTS services (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            TEXT         NOT NULL UNIQUE,
    title           TEXT         NOT NULL,
    short_summary   TEXT         NOT NULL,
    description     TEXT         NOT NULL,
    icon            TEXT,                       -- lucide icon name
    category        TEXT         NOT NULL DEFAULT 'core'
                                 CHECK (category IN ('core','support','opportunistic')),
    sort_order      INTEGER      NOT NULL DEFAULT 0,
    is_published    BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_services_category   ON services(category);
CREATE INDEX IF NOT EXISTS idx_services_published  ON services(is_published, sort_order);

CREATE TRIGGER trg_services_updated_at
BEFORE UPDATE ON services
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----- Case studies (SALA, Miskawaan, Putahracsa, …) -----
CREATE TABLE IF NOT EXISTS case_studies (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            TEXT         NOT NULL UNIQUE,
    client_name     TEXT         NOT NULL,
    industry        TEXT         NOT NULL,
    location        TEXT,
    relationship_years  INTEGER,
    hero_image_url  TEXT,
    summary         TEXT         NOT NULL,
    challenge       TEXT         NOT NULL,
    solution        TEXT         NOT NULL,
    results         TEXT         NOT NULL,
    quote_text      TEXT,
    quote_author    TEXT,
    services_used   TEXT[]       NOT NULL DEFAULT '{}',
    sort_order      INTEGER      NOT NULL DEFAULT 0,
    is_published    BOOLEAN      NOT NULL DEFAULT TRUE,
    published_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_case_studies_published ON case_studies(is_published, sort_order);
CREATE INDEX IF NOT EXISTS idx_case_studies_search    ON case_studies
    USING GIN (to_tsvector('english',
        coalesce(client_name,'') || ' ' ||
        coalesce(summary,'')     || ' ' ||
        coalesce(challenge,'')   || ' ' ||
        coalesce(solution,'')    || ' ' ||
        coalesce(results,'')));

CREATE TRIGGER trg_case_studies_updated_at
BEFORE UPDATE ON case_studies
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----- Blog posts -----
CREATE TABLE IF NOT EXISTS blog_posts (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            TEXT         NOT NULL UNIQUE,
    title           TEXT         NOT NULL,
    excerpt         TEXT         NOT NULL,
    body_md         TEXT         NOT NULL,
    cover_image_url TEXT,
    author_id       UUID         REFERENCES users(id) ON DELETE SET NULL,
    tags            TEXT[]       NOT NULL DEFAULT '{}',
    is_published    BOOLEAN      NOT NULL DEFAULT FALSE,
    published_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blog_posts_published ON blog_posts(is_published, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_blog_posts_tags      ON blog_posts USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_blog_posts_search    ON blog_posts
    USING GIN (to_tsvector('english',
        coalesce(title,'') || ' ' ||
        coalesce(excerpt,'') || ' ' ||
        coalesce(body_md,'')));

CREATE TRIGGER trg_blog_posts_updated_at
BEFORE UPDATE ON blog_posts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----- Generic CMS pages (About, Privacy, Terms, etc.) -----
CREATE TABLE IF NOT EXISTS pages (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            TEXT         NOT NULL UNIQUE,
    title           TEXT         NOT NULL,
    body_md         TEXT         NOT NULL,
    seo_title       TEXT,
    seo_description TEXT,
    is_published    BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_pages_updated_at
BEFORE UPDATE ON pages
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----- Media library (uploaded images, etc.) -----
CREATE TABLE IF NOT EXISTS media_assets (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    filename        TEXT         NOT NULL,
    mime_type       TEXT         NOT NULL,
    size_bytes      BIGINT       NOT NULL,
    storage_url     TEXT         NOT NULL,
    alt_text        TEXT,
    uploaded_by     UUID         REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_uploaded_by ON media_assets(uploaded_by);
