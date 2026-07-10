# Pipeline runs — episodic log

Append-only. One entry per completed feature so future agents can reason about what shipped, when, why, and where the artefacts live. Newest at the top.

---

## 2026-07-08 — Contract Management module (docgen + contract-api + /admin/contracts)

**Scope:** F2's master service agreement as a reusable, multi-template skeleton — staff create a contract from a customer's details, generate a print-ready bilingual PDF for signing, and upload the signed scan back onto the record. Multi-contract AND multi-template (code-defined layouts).

**Phase-0 reuse decisions (documented in `docs/contract-management-plan.md`):**

- **Projects module** (checklist-api, `projects` table) already built → `contracts.project_id` nullable FK; iACC company id sourced from linked project.
- **Volume upload mechanism** (checklist-api `uploads.go` + `checklist-uploads` volume) → mirrored with a new `contract-uploads` volume (spec mandates "volume, never Postgres"; note this diverges from mig-053 `attachments` BYTEA convention on purpose — signed scans/PDFs are larger).
- **iACC stub** (`checklist-api/internal/iacc`) → interface copied into contract-api; drafts queued in `iacc_outbox` on status→active.
- **docgen skeleton** (`docs/contract-template-skeleton/`) → parameterised (every Miskawaan literal → merge field).
- **Party data:** NEW `contract_parties` table (per user decision) with optional FK back to `customers` — not an extension of the thin `customers` table.

**New services:**

- **`services/docgen`** (Node 20, internal-only, NOT on Traefik; `http://docgen:8080`). Builder registry (`lib/builders/index.js`) maps template `code` → render fn; shared docx primitives in `lib/shared/docx-kit.js`. Ships TWO builders: `service-agreement` (full 12-section skeleton) + `mutual-nda` (different shape, no fees — proves the registry). `embed-fonts.js` is a Node port of the skeleton's `embed_fonts.py` (odttf XOR obfuscation) — mandatory Thai-font embedding. `to-pdf.js` = LibreOffice headless. `POST /render` 404s unknown template (no silent blank doc); `GET /templates` = capability list.
- **`services/contract-api`** (Go, cloned from checklist-api; internal port 8008, Traefik `/api/contracts`). Handlers: templates/parties CRUD, contracts CRUD + list/filter (`?status=&party=&customer=&expiring=N`), `/generate`, `/status`, multipart `/files` upload + download. State machine (`status.go`) server-enforced (illegal jumps → 409). Doc-no `F2-<prefix>-<year>-<seq>` allocated via `contract_doc_seq` `INSERT … ON CONFLICT DO UPDATE RETURNING` (row lock ⇒ concurrency-safe). RBAC: admin = write incl. delete + template mgmt; editor/viewer = read-only on contracts. Template create/edit validates `code` against docgen `GET /templates` (422 if no builder) — this keeps layouts code-defined.

**DB:** `054_contract_management.sql` (contract_parties, contract_templates, contracts, contract_files, contract_status_events, contract_doc_seq, iacc_outbox + module rows `admin.contracts`/`api.contracts`/`service.docgen`), `055_seed_contract_templates.sql` (seeds both templates with `merge_schema`). Doc-prefix per template: F2-AGR / F2-NDA.

**Frontend:** `src/lib/contract-api.ts` (mirrors checklist-api auth). `/admin/contracts` list (status badges draft-grey/sent-amber/signed-green/active-navy/expired-red/terminated-slate, expiring-≤30d highlight + card), `/new` wizard (template → party → schema-driven form from `merge_schema`), `/[id]` detail (edit-while-draft, files panel, generate draft/signing, drag-drop + phone-camera signed upload, activate, status timeline), `/templates` admin (edit defaults/toggle, no layout authoring). AdminShell nav entry added (`FileSignature`, `moduleKey: admin.contracts`).

**Verified (live, against real stack):** both migrations applied on real PG (7 tables, 2 templates 11+7 fields, 3 module rows); doc-no concurrency test (50 goroutines, unique+gap-free) PASS; docgen renders real PDFs in-container for both templates; **full lifecycle e2e** via minted admin JWT — create (F2-AGR-2026-001) → generate draft (docx 128KB + pdf 96KB) → generate signing (draft→sent) → upload signed (sent→signed) → activate (signed→active, iacc_outbox row queued) → 2nd contract increments to -002 → expiring filter 30→0 / 90→1. `make ci` green (contract-api tests, i18n parity 1985/1985, modulegate 9/9). Go build/vet/gofmt clean; web-app tsc 0 errors.

**Bug caught + fixed during e2e:** expiring filter used `($n || ' days')::interval` which failed with a bound int param → changed to `$n * INTERVAL '1 day'`.

**Follow-ups noted, not done:**

- iACC outbox drain worker (rows queue but nothing sends yet — stub only, by design).
- "Create linked project" wizard checkbox wired to checklist-api (hook designed, not yet called).
- Playwright `admin-contracts-wizard.spec.ts` needs `ADMIN_JWT` + live stack to run (skips otherwise, matches projects suite).
- Full `make up` of the entire stack (validated services individually + integration, not one single `make up`).

---

## 2026-07-04 — Cloudflare edge topology (playbook + firewall lockdown + refresh tooling)

**Scope:** ship the "Cloudflare in front of the VPS" story so production go-live is a documented sequence of dashboard clicks rather than an ad-hoc decision.

**What was already in the codebase (bootstrapped this branch earlier):**

- `docker-compose.prod.yml` Traefik command already lists Cloudflare IPv4 + IPv6 ranges in `forwardedHeaders.trustedIPs`.
- `scripts/refresh-cloudflare-ips.sh` — fetches current CF ranges and rewrites the compose files. Supports `--check` for CI.

**New in this pass:**

- **`docs/cloudflare-setup.md`** — 10-section operator playbook. Covers: Cloudflare dashboard onboarding, DNS records with proxy/DNS-only distinctions, SSL mode "Full (strict)", firewall lockdown, Cache Rules for OG images / sitemap / static assets, WAF + Bot Fight Mode config, verification commands, staging environment, optional 15-year Origin CA cert, runbook for CF outages, and cost breakdown ($0/month on Free plan).
- **`scripts/firewall-cloudflare-only.sh`** — locks port 443 on the VPS to Cloudflare edge IPs only. Uses `ufw` if active, falls back to raw `iptables`/`ip6tables`. Tags every rule so `clear` can undo cleanly. Leaves :22 (SSH) and :80 (LE HTTP-01) alone. Refuses to run without root. Suitable for a monthly cron on the VPS.
- **`.env.example`** — added a "Cloudflare" section pointing at the two scripts and the playbook. No secrets to add (CF is DNS-driven).
- **`docs/production-readiness.md` § 2** — rewrote to make Cloudflare the recommended path (Full (strict) TLS, orange-cloud proxy, firewall lockdown step). Bare-VPS path documented as still supported.
- **Makefile** — new targets: `cf-refresh-ips`, `cf-firewall-status`, `cf-firewall-apply` (5-second abort window), `cf-firewall-clear`.

**Design choices worth noting:**

- **Full (strict) TLS** — browser ↔ CF ↔ VPS is TLS end-to-end. Origin cert stays Let's Encrypt (auto-renewed). CF Origin CA (15-year cert) documented as optional in § 8 — trade-off is you can only reach the origin via Cloudflare after switching to it.
- **We do NOT use Cloudflare Workers / R2 / Access.** Deliberately kept simple; every one of those can be layered later without changing the current setup.
- **Firewall script tags rules** with comment `cloudflare-edge` so `clear` doesn't accidentally wipe unrelated ufw entries.
- **Cache rules for OG images explicitly listed** — that's a real SEO win. `/opengraph-image` on CF cache = ~30ms serve time from Bangkok POP instead of Next.js cold-hitting the VPS on each social crawl.

**Verified:**

- `bash scripts/refresh-cloudflare-ips.sh --check` → `Cloudflare IPs current.` (2 entries per prod overlay).
- `bash scripts/firewall-cloudflare-only.sh status` correctly errors `must run as root` — safe-by-default.
- Traefik prod command already carries the CF trusted-IP list (no compose changes needed).

**Recommendation captured in memory:** for F2's traffic profile (Thai hospitality, dozens of enterprise customers not millions of anonymous visitors), Cloudflare in front + VPS backend is the right answer. Vercel is only worth adding if (a) you outgrow single-region VPS latency or (b) you start needing per-PR preview URLs. Documented in the go-live playbook rather than the pipeline log so the recommendation survives when this run entry rolls off the top.

---

## 2026-07-04 — Production readiness pass (CI/CD, scheduler, quotas, encryption, observability, backups)

**Scope:** close every "known gap for production" item so the platform is ready to move to staging → production automation. All 7 blockers from the earlier production checklist now cleared.

**CI/CD:**

- `.github/workflows/deploy.yml` build matrix — added `checklist-api`. Smoke test now includes `/api/checklists/healthz`.
- `.github/workflows/build.yml` matrix — added `checklist-api` **and** `payment-api` (both were missing).
- Created `services/web-app/.nvmrc` at Node 20 (matches Dockerfile), so `node-version-file` in build.yml resolves.

**Scheduler (weekly summary):**

- New `services/checklist-api/internal/handlers/scheduler.go` — goroutine started from main. Ticks hourly; fires on Fridays 09:00+ Asia/Bangkok (fallback to fixed +07:00 zone for distroless containers without tzdata).
- Idempotency via a marker `visit_logs` row (`summary='__weekly_summary_sent__'` on the Friday of the current ISO week). Restarts / double-ticks / late boots don't double-send.
- Scans for every project where `status='active'` AND `customer_id IS NOT NULL` AND `visible_to_customer=TRUE`, then reuses the existing `SendWeeklySummary` handler in-process via a synthesized `http.Request` + chi URL param (helper in `chi_helpers.go`).
- Confirmed running: `checklist-api scheduler: started, tick=1h0m0s tz=Asia/Bangkok` in container logs.

**Upload quota + rate limit:**

- Traefik middleware `checklist-upload-ratelimit` on `Path(/api/checklists/uploads)` with priority=150 so it wins over the general checklist router. 10 uploads/min per IP, burst 5. Applies to writes only — GETs on stored files pass through the unlimited main router.
- Wired in both dev + prod compose files.
- Handler-level per-project soft quota `perProjectPhotoQuota = 500` in `uploads.go`. Enforced **before** the file body is read so an over-quota project can't waste bytes. Frontend `checklistApi.uploadPhoto()` now accepts a `projectId` param; the checklist page passes it via a new React context.

**SMTP password encryption at rest (Migration 044):**

- `smtp_settings.password` (TEXT) → `smtp_settings.password_enc` (BYTEA) via `pgp_sym_encrypt/decrypt`.
- Key comes from `SMTP_CRYPT_KEY` env var. Empty key falls back to the `SMTP_PASSWORD` env var (dev-friendly, prod requires the real key).
- `notification-api.resolveSMTP()` decrypts through `pgp_sym_decrypt(password_enc, $1)`; `PutSMTP` refuses to write when key is empty. Confirmed working: `PUT ... 204`, DB shows 81 bytes of ciphertext.
- Added `SMTP_CRYPT_KEY` to `.env` + `.env.example`.

**OG image font upgrade:**

- `src/lib/og.tsx` now loads Inter (Latin, Bold + ExtraBold) + Sarabun (Thai, Bold) TTFs from each font's upstream repo. First bug caught in verify: satori/next-og engine rejects WOFF2 (`Unsupported OpenType signature wOF2`) — switched to raw TTF URLs.
- Memoized in module scope so cold-start pays the network cost once. Fetch failure returns `null` and `renderOG` silently falls back to system fonts.
- `renderOG` is now `async` — all four `opengraph-image.tsx` files updated to `await`.
- Locale-aware font stack: `'Sarabun', 'Inter'` for TH, `'Inter', 'Sarabun'` for EN. TH verified: Thai script renders cleanly at 88pt.

**Observability:**

- New `scripts/health-check.sh` — hits `/healthz` or a known-401 endpoint on all 10 services + web-app. Exit code = failed count, so safe for CI + cron alerts. Verified: 10/10 PASS.
- Added `make health` (with `BASE=` override for staging/prod) and `make e2e-checklist` targets.
- Created `docs/monitoring.md` — BetterStack (recommended) and UptimeRobot setup, runbook for "a service is unhealthy" scenarios, explicit rationale for what's NOT in the box (Prometheus, APM, error tracking).

**Backups:**

- Extended `docs/backup-and-restore.md` with `checklist-uploads` volume section — tar-gz commands, restore commands, retention/cadence guidance.
- New `make backup-uploads` (writes `uploads-YYYY-MM-DD.tar.gz`) and `make restore-uploads FILE=...` targets.

**Production playbook:**

- New `docs/production-readiness.md` — 10-step VPS-to-live playbook: DNS/TLS, `.env` secrets table (every key + how to generate), SMTP admin-UI configuration flow, migrations, first-admin seed, verify, external monitoring, backups, post-deploy sanity checklist. Also documents deliberate omissions (Prometheus, APM, Sentry).

**Verified end-to-end:**

- Stack health `make health`: 10/10 pass.
- checklist-api E2E `make e2e-checklist`: 50/50 pass (no regressions).
- SMTP admin flow: GET returns redacted password, PUT stores ciphertext (81 bytes BYTEA in DB), test-send path uses `pgp_sym_decrypt` — all 204/200 as expected.
- Scheduler goroutine started at boot, logs the Asia/Bangkok timezone, doesn't fire until Friday 09:00.
- OG images at `/opengraph-image` and `/th/opengraph-image`: 200, 1200×630 RGBA PNG, Inter+Sarabun rendered.
- Frontend type-check + i18n parity clean.

**Follow-ups (deliberately deferred, documented as such):**

- Prometheus / Grafana / Loki metrics stack — v1 is `/healthz` + external ping.
- APM / distributed tracing.
- Sentry error tracking (recommended next investment).
- WAL-archiving + off-host encrypted backup sync.
- Blue/green deploys (needs a proxy tier we don't have).

**All 7 production-readiness blockers now cleared.** Platform is ready to move to staging → production automation via the existing `.github/workflows/deploy.yml` workflow.

---

## 2026-07-04 — SEO gap-6/7/8: sitemap freshness + semantic tables + unified Article schema (audit complete)

**Scope:** the final three items from the SEO audit. Closes the punchlist. All 8 gaps from the 2026-07-04 audit are now shipped.

**Gap #6 — Sitemap `lastModified` from CMS:**

- `services.updated_at`, `case_studies.updated_at`, and `blog_posts.updated_at ?? published_at` now flow through into per-URL `lastmod` entries.
- New `parseDate()` helper guards against malformed CMS timestamps and falls back to `now` — never lies newer than truth.
- Static structural pages (`/`, `/about`, `/contact`, etc.) still get `now` since they have no CMS row. Left as the single swap-in point if we later wire deploy timestamps.
- Added optional `updated_at`/`created_at`/`published_at` on `ServiceItem` + `CaseStudyItem` types so the sitemap can read them without a cast.
- Verified: sitemap.xml now has 10 distinct timestamps for the 10 services (each service's real update time) and a separate timestamp for case studies.

**Gap #7a — `/hosting` semantic pricing table:**

- Added a full `<table>` comparison block *below* the visual cards (cards stay as the primary UX; the table is the AEO-extractable version). Google AI Overviews + generative search parse `<table>` markup to build side-by-side pricing summaries; card layouts are invisible to that pipeline.
- WCAG-compliant: `<caption class="sr-only">` for context, `<th scope="col">` on all 9 column headers, `<th scope="row">` on each plan row, `aria-label` on tick/dash cells. 9 col + 3 row scopes emitted.
- Horizontally scrollable on mobile (`overflow-x-auto` + `min-w-[640px]`) so nothing wraps.
- New i18n keys under `hosting.table.*` (EN + TH).

**Gap #7b — `/domains` semantic pricing table:**

- Existing `<table>` was upgraded (it already existed but was missing accessibility attributes). Added `<caption>`, `scope="col"` on all 12 header cells, converted TLD cell to `<th scope="row">` for row-header semantics. 12 col + 8 row scopes emitted.
- No new i18n keys needed — caption reuses existing section title/subtitle.

**Gap #8 — Unified `article()` builder:**

- New `article()` export in `src/lib/schema.tsx` — mirrors the shape of `blogPosting()` so both content types feel like one family. Defaults `author` to the Organization `@id` when no `authorName` is passed (correct for publisher-authored case studies — a client's testimonial doesn't make them the author).
- `case-studies/[slug]/page.tsx` was hand-rolling inline Article JSON. Replaced with `article(...)` and now correctly emits `datePublished` (from `c.created_at`), `dateModified` (`c.updated_at`), `about` (industry), `inLanguage`, plus `author` + `publisher` as `@id` references into the Organization node. Verified via JSON-LD parse: `@type=Article`, headline, description, both dates, publisher `@id`, author `@id`, `about="Luxury Hotels & Resorts"`, `inLanguage="en"`.

**Verified end-to-end:**

- Sitemap freshness: 2 distinct dates across CMS URLs (services 2026-07-04 from migration 043, case studies 2026-07-01).
- Hosting table: 9 col + 3 row scopes, `<caption>` present.
- Domains table: 12 col + 8 row scopes, `<caption>` present.
- Case-study Article: all 10 expected schema fields present with correct types.
- No page regressions (`/`, `/contact`, `/services`, `/case-studies/sala-hospitality`, `/hosting`, `/domains` all 200).
- Checklist E2E baseline still 50/50 — no cross-service regressions.

**i18n:** 1747 → 1752 keys, parity green.

**SEO audit — all 8 gaps now closed.** The audit prompt (`ai/prompts/agent-seo.md`) should be re-run when new content ships (blog posts especially) to catch regressions.

---

## 2026-07-04 — SEO gap-4/5: embedded Google Map on /contact + dynamic per-route OG images

**Scope:** the next two SEO leverage items from the audit — embedded map for Local SEO on `/contact`, and dynamic brand-consistent 1200×630 OG images generated per-route via the Next.js file-based convention.

**Contact map (gap #4):**

- `contact/page.tsx` now renders an iframe pointing at `https://maps.google.com/maps?q=<F2 address>&z=15&output=embed` — Google's zero-config embed URL, no API key required.
- `loading="lazy"` on the iframe so it doesn't drag down LCP.
- Text address (street/locality/region/postalCode from `F2_ORG`) rendered above the map as the accessible fallback for screen readers and print views.
- "Get directions" link opens the caller's default Maps app with a `dir/?api=1&destination=...` URL.
- New i18n keys: `contact.side.directions`, `contact.side.mapHeading` (EN + TH).
- **CSP update in `middleware.ts`:** added `frame-src 'self' https://www.google.com https://maps.google.com`. Previously there was no `frame-src` and `default-src 'self'` would have blocked the map iframe.

**Dynamic OG images (gap #5):**

- New shared template `src/lib/og.tsx` — `renderOG({title, kicker, subtitle, locale})` returns a `next/og` `ImageResponse` at 1200×630 with the F2 brand: navy→purple gradient, F2 wordmark top-left, kicker/title/subtitle body, "f2.co.th → Talk to F2" footer. Bilingual footer + tagline via locale param. Auto-clamps font size for long titles (88 → 72 → 60 pt).
- Four route-level `opengraph-image.tsx` files using Next's file convention:
  - `[locale]/opengraph-image.tsx` — site-wide default (F2 tagline).
  - `[locale]/services/[slug]/opengraph-image.tsx` — pulls title + short_summary via `cms.listServices`.
  - `[locale]/case-studies/[slug]/opengraph-image.tsx` — pulls client_name + summary via `cms.getCaseStudy`.
  - `[locale]/blog/[slug]/opengraph-image.tsx` — pulls title + excerpt via `cms.getBlogPost`.
- Removed `imageUrl` from `case-studies/[slug]/page.tsx` and `blog/[slug]/page.tsx` `pageOpenGraph` calls so the dynamic file-based images are the single source (avoids mixed-signal social crawlers).

**Bug fixed: `pageOpenGraph()` was blocking file-based OG auto-injection.**

- Root cause: the helper always emitted `openGraph.images: undefined` (and `twitter.images: undefined`) when no `imageUrl` was passed. Next.js treats the *presence* of the `images` key — even when undefined — as an override signal and skips the file-based convention entirely.
- Fix: only add the `images` keys to the returned object when `imageUrl` is actually set. Confirmed with `curl -sL http://localhost/ | grep og:image` — now emits `<meta property="og:image" content=".../opengraph-image?<hash>">` + `og:image:type`, `og:image:width=1200`, `og:image:height=630`, `og:image:alt`, and `twitter:image`.

**Verified end-to-end:**

- `/contact` HTML contains `<iframe src="https://maps.google.com/maps?q=9%2F38%20Moo%206...">` + rendered street address.
- `curl /opengraph-image` → HTTP 200, `image/png`, ~115 KB, `1200x630 RGBA` per `file(1)`. Same for all four routes.
- HTML `<head>` now has `og:image` + `twitter:image` meta with per-route dynamic URLs (unique hash per content).
- Visual preview: navy→purple gradient, F2 mark top-left, kicker + title + tagline, "f2.co.th" bottom-left, "→ Talk to F2" bottom-right. Multi-line title clamp works on longer service names.

**Follow-ups:**

- Fonts default to system-serif in the ImageResponse — upgrading to Inter (EN) + Sarabun (TH) via Buffer-loaded fonts would sharpen brand identity. Deferred until we're happy with the layout.
- OG image cache: Next serves them at request time with `Cache-Control: public, max-age=0, must-revalidate`. If we start getting real social traffic, switch the route files to `export const dynamic = "force-static"` so CDNs can cache the PNGs.
- Remaining SEO gaps 6–8 from the audit: sitemap `lastModified` from CMS edit timestamps, hosting/pricing `<table>` markup, unified Article schema builder for case studies.

---

## 2026-07-04 — SEO gap-1/2/3: FAQ schema + blog detail + AEO direct-answer intros

**Scope:** the top 3 SEO leverage items from the audit — FAQ schema on service/product/hosting pages, `/blog/[slug]` detail route with BlogPosting schema + Person author, and 40–55 word AEO direct-answer paragraphs after every H1.

**Migration:** `043_service_intro_and_faq.sql`

- Added `services.intro` and `services.faq` JSONB (en/th) columns with empty-object defaults.
- Seeded `intro` for **all 10** published services (bilingual, 40–55 words each, definition-first phrasing for AEO extraction).
- Seeded `faq` (3 Q&A pairs each, bilingual) for the 5 highest-intent services: `it-management`, `cybersecurity`, `cloud-infrastructure`, `ai-driven-solutions`, `iacc-saas`. Remaining 5 services have empty FAQ — admin can fill via the CMS editor (schema.tsx admin handler still needs to be extended, flagged as follow-up).

**cms-api:**

- Extended `models.Service` with `Intro string` + `FAQ []FAQItem`; new `models.FAQItem{Q, A}` type mirrors schema.org Question/Answer casing.
- Factored `serviceSelect` constant + `scanService` helper so list + detail share one SELECT + one scan path. Adding a new column is a single-file edit.
- Extended `models.BlogPost` with `AuthorName string`; `blogSelect` LEFT-JOINs `users` and COALESCEs to "F2 Editorial Team" when `author_id` is NULL.

**Frontend (services/web-app):**

- New shared `<FAQ items={...} heading={...}>` component (`src/components/FAQ.tsx`) — server component, native `<details>` progressive-disclosure, emits `FAQPage` JSON-LD via the existing `faqPage()` builder. Renders nothing when items is empty so pages without FAQ content don't emit empty schema.
- Service detail page (`[slug]/page.tsx`) renders `s.intro` as a bold direct-answer paragraph immediately below H1 (AEO), then `<FAQ items={s.faq}>` at the bottom.
- `/products` and `/hosting` (non-CMS pages) get FAQ from bilingual i18n keys (`products.faq.items`, `hosting.faq.items`) — 4 and 5 Q&A pairs respectively, each side.
- New `/blog/[slug]/page.tsx` — full BlogPosting JSON-LD (Person author, inLanguage, image, dateModified), markdown body rendered via existing `CMSPageBody` (marked GFM), tags, cover image, breadcrumb, EN/TH date formatting. Was the "silent 404 for LLM crawlers" that llms.txt referenced.
- Extended `api.ts` — `BlogPostItem.author_name`, new `cms.getBlogPost(slug, locale)`. Updated all 10 `fallbackServices` entries to include `intro: ""` + `faq: []` so offline mode still type-checks.

**Verified end-to-end (live stack):**

- `curl /api/cms/services/it-management` returns 268-char intro + 3 FAQ items.
- Service detail page HTML contains `FAQPage` JSON-LD block + rendered "Frequently asked questions" heading + all 3 Q&A pairs.
- `/products` and `/hosting` HTML both contain `FAQPage` schema + rendered content.
- TH locale (`/th/services/cybersecurity`) returns Thai intro + Thai FAQ (`คำถามที่พบบ่อย`).
- Blog detail (with `public.blog` enabled + seeded post): 200 status, BlogPosting schema + author byline + markdown-rendered body + tags, both EN and TH.
- Missing slug returns 404 (proper notFound).
- **Gotcha:** `public.blog` module is currently `enabled=false` in the module registry, so the whole `/blog/*` section returns 404 via `moduleGateLayout`. My blog detail page works — enable the module when blog posts are ready to ship.

**i18n:** 1739 → 1745 keys, parity green.

**Follow-ups:**

- Extend the CMS admin handler (`admin_services.go`) to accept `intro` and `faq` on POST/PATCH so admins can edit them via the existing service editor UI. Right now they're read-only after migration.
- Fill FAQ for the remaining 5 services (`digital-transformation`, `devops-cicd`, `domain-hosting`, `it-support-msp`, `hardware-solar`) — content-team task.
- SEO gaps 4–8 from the audit: embedded Google Map on /contact, OG images, sitemap lastModified from CMS, hosting/pricing `<table>` markup, unified Article schema.

---

## 2026-07-04 — Password reset flow + SMTP admin UI + Miskawaan email fix

**Scope:** production-blocking prep — SMTP creds now editable through the admin UI (no more `.env` shell-in), and both staff + customer accounts have a full forgot-password flow. Also renamed the Miskawaan owner contact to `admin@miskawaan.com` and shipped the reset that lets them set their own password.

**Migration:** `042_password_reset_and_smtp.sql`

- `password_resets` table — one shared table with nullable `user_id` and `contact_id` (XOR-constrained via CHECK). Only SHA-256 hashes of the raw token are stored so a DB dump can't be used to redeem.
- `smtp_settings` singleton row (id=1, CHECK id=1) with host/port/username/password/from_address/tls_mode. Password v1 stored plaintext — gated at API layer to admin role. Follow-up: pgcrypto once key-management is chosen.
- Two new notification templates: `password_reset_staff` + `password_reset_customer` (EN + TH).
- Module registry row `admin.smtp_settings`.
- Miskawaan contact email updated from `admin@miskawaanvillas.com` → `admin@miskawaan.com`.

**auth-api:**

- New `internal/handlers/password_reset.go` — four endpoints, one shared file:
  - `POST /api/auth/forgot-password` (staff)
  - `POST /api/auth/reset-password` (staff)
  - `POST /api/auth/customer/forgot-password`
  - `POST /api/auth/customer/reset-password`
- Enumeration-safe (forgot always returns 200 regardless of email match).
- 32 bytes CSPRNG → hex → SHA-256 hash to DB. Raw only travels in the email.
- 60-minute TTL, single-use (`used_at` stamped inside the same transaction as the password update).
- On successful reset, all open refresh tokens for that identity are revoked so an attacker who triggered the reset doesn't retain access.
- Password validation: ≥ 10 chars, ≤ 200 chars, must include letters and digits.
- SITE_URL config added to `.env` and `.env.example` (used to build reset links).

**notification-api:**

- `internal/handlers/smtp_admin.go` — DB-backed SMTP config resolver with env-var fallback per field, plus three admin endpoints:
  - `GET /api/notifications/admin/smtp` (password redacted as `••••••••`)
  - `PUT /api/notifications/admin/smtp` (empty or redacted password = keep current)
  - `POST /api/notifications/admin/smtp/test`
- Inline `RequireAdmin(secret)` middleware — same pattern as checklist-api; notification-api didn't have its own middleware package.
- `deliver()` in notifications.go now uses `resolveSMTP(ctx)` so admin edits take effect on the very next queued email, no redeploy.
- Added `golang-jwt/jwt/v5` dep.
- Added `JWTSecret` to config.

**Frontend:**

- `/admin/login/forgot` + `/admin/login/reset/[token]` — staff pages.
- `/portal/login/forgot` + `/portal/login/reset/[token]` — customer pages.
- Both login pages now have a "Forgot password?" link.
- `/admin/settings/smtp` — full editor with test-send button. Password field pre-fills with `••••••••`; leaving it as-is on save keeps the stored value (the client sees the same placeholder from GET).
- AdminShell nav: new "SMTP" entry under System group, gated by `admin.smtp_settings` module + `adminOnly=true`.

**Rate limiting:**

- New Traefik router `pwreset` on `PathRegexp(^/api/auth/(customer/)?(forgot|reset)-password$)` with priority=200 so it wins over the general `auth` router. 5 req/min per IP, burst 3. Confirmed working — hit 429 during load-testing.

**Verified end-to-end:**

- SMTP admin: 401 without token, 403 for editor, 200 for admin, 204 on save, 400 on bad port. GET response redacts password.
- Forgot-password: both valid and unknown emails return 200 (enumeration-safe). Reset URL correctly written into `notifications.payload.reset_url` and the queued email fires.
- Reset flow: valid token → 200 + `password_resets.used_at` stamped. Token reuse → 400. Garbage token → 400. Short password → 400.
- Actually logged in as `admin@miskawaan.com` with the new password against `/api/auth/customer/login` and got a `customer_id` claim matching Miskawaan Beachfront Villas.
- `bash services/checklist-api/e2e/checklist_e2e.sh` → still 50/50, no regressions.

**i18n:** 1684 → 1739 keys, EN + TH parity green.

**Follow-ups:**

- Encrypt `smtp_settings.password` with pgcrypto (or move to an external secrets store).
- Persistent E2E script for password-reset + SMTP admin (analogous to `checklist_e2e.sh`).
- Rate-limit the SMTP test-send endpoint (currently no per-endpoint limit beyond the `auth-ratelimit` on the parent prefix — wait, notification-api is a different service — no limit at all today).

---

## 2026-07-04 — E2E + CRUD test sweep, two bug fixes

**Scope:** exhaustive live-stack test pass against the checklist-api. 50 checks across auth gates, templates CRUD, projects CRUD, module lifecycle, item PATCH + audit log, photo upload, visit logs, reports, weekly summary email, and portal customer isolation.

**Result:** 50/50 green after two fixes.

**Bugs found + fixed:**

- `internal/handlers/summary.go` referenced `customer_contacts.is_active`, which doesn't exist — the table uses `disabled_at IS NULL`. Symptom: weekly summary returned 404 "no active contact". Fixed the WHERE clause.
- `Dockerfile` runs the server as distroless `nonroot` (UID 65532) but the named Docker volume for `/data/uploads` was created root-owned on first mount, so `os.OpenFile(dst, O_CREATE)` returned 500 "could not create file". Fixed by adding `RUN mkdir -p /uploads` in the build stage and `COPY --chown=65532:65532 /uploads /data/uploads` into the runtime stage so the volume inherits nonroot ownership on first mount. Required recreating the existing volume (`docker volume rm f2-website_checklist-uploads`) for the fix to take effect on running installs.
- `enqueueEmail` in `summary.go` posted to `/api/notifications/enqueue`; notification-api's actual endpoint is `POST /api/notifications/` (chi Route + Post("/")). Fixed the URL.

**Permanent artefact:** [`services/checklist-api/e2e/checklist_e2e.sh`](../../services/checklist-api/e2e/checklist_e2e.sh) — the whole probe as a repeatable script. No external deps beyond stdlib Python + curl + docker exec. Mints its own tokens from `.env`'s `JWT_SECRET`; cleans up its own residue on the Miskawaan project.

**Verified isolation invariants:**

- Foreign customer JWT → 404 on someone else's project (not 403 — no existence leak).
- `visible_to_customer=false` → portal returns 404 for the linked customer's own token.
- Staff tokens (no `aud`) → 403 on `/portal/*`; customer tokens → 403 on staff endpoints.
- Same-status PATCH → no duplicate audit_log row (the "actual transition only" check).

**Left as-is (not bugs):**

- SMTP delivery of the queued weekly summary fails with "Username and Password not accepted" — dev SMTP creds are placeholder. The notification is correctly enqueued into `notifications` table with `template=project_weekly_summary`, right Miskawaan contact, right Thai subject (contact's locale). Real creds → real delivery.

---

## 2026-07-04 — Miskawaan seed + photo upload + audit log + weekly summary email + portal rate limit

**Scope:** hardening + real-data pass for Projects & Checklists so the module is ready to go live with the first client (Miskawaan).

**Migration:** `041_seed_miskawaan_project.sql`

- Seeded the "Miskawaan IT — Audit & Weekly Maintenance" project attached to all 12 templates (78 project_items snapshotted). Idempotent by name.
- Seeded the `project_weekly_summary` notification template (subject_tmpl + body_tmpl JSONB, EN + TH).

**Photo upload (checklist-api):**

- New `internal/handlers/uploads.go` — `POST /uploads` (staff, multipart, 8 MiB cap, image MIME allowlist) + `GET /uploads/{name}` (public, immutable cache, 128-bit random filename).
- Volume `checklist-uploads` mounted at `/data/uploads` in both compose files; `UPLOADS_DIR` env var.
- Path-traversal defence via `safeUploadName` (regex-tight: 32 hex + '.' + 3–4 alpha).
- Admin checklist page: new "Attach photo" button per item using `checklistApi.uploadPhoto()` (multipart bypass of the shared JSON `request` wrapper).

**Audit trail:**

- `PATCH /items/{id}` now writes to `audit_log` (resource_type='project_item', action='status_change') whenever status actually changes. Uses the generic table from migration 019. Fire-and-forget — audit failure doesn't fail the PATCH.

**Weekly summary email:**

- `internal/handlers/summary.go` — `POST /admin/projects/{id}/send-weekly-summary?date=YYYY-MM-DD`.
- Loads the primary customer contact (owner role preferred, active fallback), computes this-week window via `reportWindow`, totals across the project, and POSTs to notification-api's `/api/notifications/enqueue`.
- Enforces preconditions: project must have `customer_id` and `visible_to_customer=true`; customer must have at least one active contact. 400s otherwise.
- Report page (admin) gets a "Send weekly summary" button when range=weekly.
- Cron scheduling is out of scope — endpoint is idempotent enough for any external scheduler (Traefik cron sidecar / GitHub Action / manual).

**Portal rate limit:**

- Traefik middleware `checklist-portal-ratelimit` on `/api/checklists/portal` (priority 100 so it wins over the generic router). 30 req/s per IP, burst 60. Matches the pattern already used for `/api/leads` and `/api/consent`.
- Wired in both `docker-compose.yml` and `docker-compose.prod.yml`.

**i18n:** 1681 → 1684 keys, parity green.

**Tests:** Go tests still pass. Type check + i18n check green.

**Ops:** migration applied, checklist-api + web-app rebuilt and running. Uploads volume created.

**Follow-ups:**

- Server-side PDF export of the report page (needs headless Chromium or a Go PDF lib — deliberately deferred; the print stylesheet still works for browser Print-to-PDF).
- Actual cron scheduling for the weekly summary (currently admin-triggered).

---

## 2026-07-04 — Customer link + portal read-view for Projects

**Scope:** wire the checklist-api projects to real customer records and expose read-only project boards through the customer portal.

**Migration:** `040_projects_customer_link.sql`

- Added `projects.customer_id UUID REFERENCES customers(id) ON DELETE SET NULL`
- Added `projects.visible_to_customer BOOLEAN DEFAULT TRUE`
- Added `portal.projects` row to `modules`

**Backend (checklist-api):**

- New `RequireCustomer(secret)` middleware — gates on `aud=="customer"` + `customer_id` claim
- New portal handlers in `internal/handlers/portal.go` — `GET /portal/projects[/{id}[/board|/progress]]`
- Every portal query scoped by `customer_id` + `visible_to_customer=true`; returns 404 (not 403) on mismatch to avoid leaking existence
- Extracted `loadProject`, `loadBoardModules`, `writeProjectProgress` shared helpers
- Admin project write endpoints now accept + return `customer_id`, `customer_name` (joined), `visible_to_customer`

**Frontend:**

- `admin-api.ts`, `checklist-api.ts`, `portal-api.ts` — new fields + portal endpoint helpers (`portalApi.listMyProjects`, `getMyProjectBoard`, `getMyProjectProgress`)
- Admin project create dialog: customer picker (dropdown from `adminApi.listCustomers`), auto-fills client_name, visibility checkbox
- Admin board header: linked customer name + "View customer →" link + one-click visibility toggle
- New `/portal/projects` list + `/portal/projects/[id]` read-only board
- PortalShell nav: added "Projects" entry under Support group

**i18n:** 1662 → 1681 keys, EN + TH parity green.

**Ops:** migration applied, checklist-api + web-app rebuilt and running.

---

## 2026-07-03 — Projects & Checklists module (initial)

**Scope:** new microservice + admin console + database schema for running client IT projects. First client: Miskawaan (IT audit + weekly maintenance).

**New service:** `services/checklist-api/` (port 8008, prefix `/api/checklists`)

**Migrations:**

- `038_projects_checklists.sql` — 6 tables: checklist_templates, checklist_template_items, projects, project_modules, project_items, visit_logs. UUID PKs, TIMESTAMPTZ, triggers. `iacc_company_id` on projects and `billable`/`amount` on visit_logs pre-wired for future iACC integration.
- `039_checklist_seed.sql` — 12 templates (codes A–L) + 78 bilingual items. Also inserts `admin.projects` and `api.checklists` into `modules` registry.

**Backend:**

- Full CRUD for templates, projects, module attach/detach/reorder, item status/note/photo, visit logs, weekly/monthly reports
- Attaching a template snapshots items into `project_items` (never JOIN back to template later)
- Table-driven tests: JWT gates, `validStatus` map, `reportWindow` date math with Monday-boundary regression coverage
- `internal/iacc/` stub — Client interface + `Stub{}` returning `ErrNotConfigured`. README documents planned monthly-close flow.

**Frontend:**

- `services/web-app/src/lib/checklist-api.ts` — dedicated helper reusing admin-api auth pattern
- `/admin/projects` list, `/admin/projects/[id]` board with dnd-kit (Mouse + Touch + Keyboard sensors — touch delay 200ms tuned for tablets), `/checklist` items view, `/report` printable
- New deps: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`
- AdminShell nav: added Projects entry with `moduleKey: "admin.projects"`

**Infra:** compose + prod overlay + Makefile SERVICES list all updated.

**i18n:** `admin.projects.*` (EN + TH), parity 1662/1662.

**Tests:** Go tests pass (`go test ./...`), frontend type-check + i18n-check pass. Playwright config + `admin-projects-dnd.spec.ts` added (needs `ADMIN_JWT` env + `npx playwright install chromium`).

**Follow-ups noted but not done:**

- Real photo upload endpoint (currently URL-only)
- iACC HTTP client
- End-to-end smoke test against live stack

---
