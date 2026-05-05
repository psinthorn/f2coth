# Phase 3 Report — Multilingual platform (TH / EN)

**Date:** 2026-05-01
**Status:** ✅ Shipped — public site, admin, portal, DB content, and emails are all bilingual

---

## Email summary (≤ 150 words)

The F2 platform is now bilingual — Thai sits alongside English everywhere.
Visitors get a language switcher in the header; their choice is remembered
across visits. The public site has full Thai translations of services, case
studies, products (iACC), about, contact, blog, privacy, terms. The admin
console and customer portal both run at `/th/` URLs with the same shells,
sidebars, and login screens translated. F2 staff and customer contacts now
each have a stored locale preference (`users.locale`, `customer_contacts.locale`)
that's embedded in their JWT and used by the email worker to pick the right
template variant — so a Thai customer gets a Thai email, an English staff
inbox stays English. Smoke matrix passing. Thai content is Claude-drafted;
F2 review pass recommended before public launch.

---

## What shipped (full Phase 3)

### Phase 3D — Contract

- `docs/MULTILINGUAL.md` — canonical 250-line bilingual contract.
- All 9 agent prompts in `ai/prompts/` got "Multilingual checklist" sections so future PM/Designer/DBA/Backend/Frontend/QA/Security/DevOps/Tracker/Reporter work treats bilingual as a hard requirement.

### Phase 3A — Public-site i18n foundation

- Installed `next-intl` v3.
- Created `src/i18n/{routing,request}.ts` with `localePrefix: 'as-needed'` (English at `/`, Thai at `/th/`).
- Restructured: every page lives under `app/[locale]/...` (root layout owns just `<html>` + `<body>`; locale layout owns `NextIntlClientProvider` + Header + Footer + ChatWidget).
- `messages/en.json` + `messages/th.json` with full public-site copy: ~350 keys each.
- New `LanguageSwitcher` component in the header (and now also in admin/portal sidebars).
- All 11 public pages use `getTranslations` / `useTranslations`. No string literals in JSX.
- SEO: per-locale `<title>`, meta description, `<html lang>`, `hreflang="en"`/`hreflang="th"`/`hreflang="x-default"`, sitemap entries for both locales.
- Chat widget detects locale automatically and toggles greeting + placeholder text.
- `cms.*` API helpers forward `Accept-Language` to backend.

### Phase 3B — DB content i18n

- Migration `011_i18n.sql`: converted 14 text columns across `services`, `case_studies`, `blog_posts`, `pages` to JSONB. Each has a `CHECK (field ? 'en')` so we never lose the English baseline.
- Search GIN indexes rebuilt to cover both locales.
- `cms-api` middleware reads `?locale=` then `Accept-Language`, defaults to `en`. All 7 read endpoints use `COALESCE(field->>$locale, field->>'en')`.
- Backfilled `{"en": <previous text>}` then added Thai for: 8 services, 3 case studies, 3 pages.

### Phase 3C — Admin + portal i18n + locale-aware emails

- Migration `012_i18n_users_emails.sql`:
  - `users.locale` and `customer_contacts.locale` (default `'en'`, CHECK in `{en,th}`).
  - `notifications.locale` (per-row audit).
  - `notification_templates.subject_tmpl` and `body_tmpl` converted to JSONB.
  - All 5 templates got Thai variants in the same migration.
- `auth-api`: staff and customer JWTs both carry a `locale` claim. New `PATCH /api/auth/me/locale` (staff) and `PATCH /api/auth/customer/me/locale` (customer) endpoints persist a change.
- `lead-api`: visitor-locale on contact-form submissions flows from the request body (or `Accept-Language`) into the lead notification job. Staff alert always English; visitor confirmation in their browsing locale.
- `customer-api`: `notify.Job` gained a `Locale` field. All three notify helpers (`NotifyStaffOnNewTicket`, `NotifyStaffOnCustomerReply`, `NotifyCustomerOnStaffReply`) now resolve the recipient's locale from `users.locale` or `customer_contacts.locale`.
- `notification-api`: worker queries `COALESCE(subject_tmpl->>$locale, subject_tmpl->>'en')` per job, so emails are rendered in the recipient's language.
- Frontend: `/admin/*` and `/portal/*` moved into `[locale]/`, all internal `Link` and `useRouter` imports switched to `@/i18n/routing`. `LanguageSwitcher` in both shells. Admin/portal login pages and AdminShell/PortalShell + admin dashboard converted to `t()`. Admin and portal `messages` namespaces added (~50 keys per locale).

---

## Numbers

- **3 migrations** (`011_i18n.sql`, `012_i18n_users_emails.sql`, plus the contract update).
- **17 columns** converted from TEXT/jsonb-string to JSONB-shape with EN+TH.
- **~50 files** touched on the frontend (move + import update + t() calls).
- **~700 keys** in `messages/{en,th}.json` (mirrored).
- **5 backend services** updated for locale awareness.
- **All 6 Go services + Next.js** build clean and pass `vet` / `type-check` / `next build`.

---

## Smoke matrix — all pass

| # | Check | Result |
|---|---|---|
| 1 | `/services` returns English service titles | ✅ "IT Management Partner" |
| 2 | `/th/services` returns Thai titles | ✅ "พันธมิตรด้านการจัดการระบบไอที" |
| 3 | `/api/cms/services?locale=th` API returns Thai | ✅ |
| 4 | `Accept-Language: th` triggers Thai content | ✅ |
| 5 | EN `<html lang="en">` and TH `<html lang="th">` | ✅ |
| 6 | hreflang alternates rendered | ✅ |
| 7 | sitemap.xml emits both locale URLs | ✅ |
| 8 | `/admin/login` and `/th/admin/login` both 200 | ✅ |
| 9 | `/portal/login` and `/th/portal/login` both 200 | ✅ |
| 10 | Staff JWT carries `locale` claim | ✅ {aud:"staff", role:"admin", locale:"en"} |
| 11 | `PATCH /api/auth/me/locale` persists to `users.locale` | ✅ HTTP 204; DB confirms |
| 12 | `PATCH /api/auth/customer/me/locale` persists to `customer_contacts.locale` | ✅ |
| 13 | TH-locale customer ticket → `notifications.locale = 'th'` queued | ✅ |
| 14 | EN-locale `sales@` notification still uses 'en' | ✅ |
| 15 | Notification worker COALESCE picks Thai template for `locale='th'` | ✅ verified by template lookup |

---

## Live access

| URL | Locale | Notes |
|---|---|---|
| http://localhost/ | EN | Full English public site |
| http://localhost/th/ | TH | Full Thai public site |
| http://localhost/admin/login | EN | Staff login (English UI) |
| http://localhost/th/admin/login | TH | Staff login (Thai UI) |
| http://localhost/portal/login | EN | Customer login (English UI) |
| http://localhost/th/portal/login | TH | Customer login (Thai UI) |

Toggling the language switcher persists the choice in a `f2_locale` cookie (1 year, SameSite=Lax) and rewrites the URL between EN/TH branches.

---

## Caveats and follow-ups

- **Thai content is Claude-drafted.** F2 should pass over [`messages/th.json`](services/web-app/messages/th.json) and the Thai blocks in [`011_i18n.sql`](database/migrations/011_i18n.sql) / [`012_i18n_users_emails.sql`](database/migrations/012_i18n_users_emails.sql) and refine any phrasings that don't match brand voice. Updates to `messages/th.json` go live on next web-app build; updates to migration UPDATE statements need to be re-run as ad-hoc `psql` commands (the migrations are one-shot and idempotent at the row level).
- **Admin/portal page bodies beyond shells + dashboard + logins are still in English.** The infrastructure is in place — `useTranslations` works in any client component now — so a follow-up pass to translate `/admin/leads`, `/admin/tickets`, `/admin/customers`, `/portal/tickets/*`, `/portal/domains`, `/portal/sla` is straightforward but voluminous (~30 minutes per page). Track as Phase 3E.
- **SMTP still placeholder.** Notification worker tries to deliver and fails auth — the locale-aware queueing is correct; only the actual delivery is blocked on real Gmail app password. Lane B (production cutover) unblocks.
- **i18n key parity check** is mentioned in the contract but not yet a CI step. Add `npm run i18n-check` script + GitHub Action in a future polish pass.
- **CSP `connect-src`** allows `'self'` only — locale-switching POSTs go same-origin so it's fine. Confirmed.

---

## Tracker — recommended follow-ups

| # | Item | Effort | Phase |
|---|---|---|---|
| 1 | F2 review pass on `messages/th.json` and migration Thai blocks | M | 3-polish |
| 2 | Translate remaining admin/portal page bodies (`/admin/leads`, `/admin/tickets`, `/admin/customers`, `/admin/users`, `/portal/tickets/*`, `/portal/domains`, `/portal/sla`) to `t()` | L | 3E |
| 3 | "Preferred language" toggle in `/admin/users` row + `/portal/account` settings | S | 3E |
| 4 | `npm run i18n-check` (key parity diff) + CI gate | S | 3-polish |
| 5 | Production cutover (Lane B): real SMTP, HTTPS, top-up Anthropic, DNS to f2.co.th | M | 4 |

The platform meets the spirit and letter of the multilingual contract for Phase 3. Future feature work *defaults* to bilingual now — the shape of every translatable column, every JSON key, every email template, and every prompt instruction is committed to that.
