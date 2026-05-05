# Phase A Report — Infrastructure section (Domains, Hosting, Cloud, DevOps)

**Date:** 2026-04-28
**Status:** ✅ Shipped — public funnels, admin view, DB content, and partnership refresh live in EN + TH

---

## Email summary (≤ 150 words)

F2 now has a public Infrastructure section. Two new public pages — `/domains`
and `/hosting` — surface live pricing pulled from the database. The domain
table is split into THNIC (Thai .co.th / .or.th / .in.th) and ResellerClub
(.com / .net / .org / .asia / .biz) groups, with a search box that drops
qualified leads into the CRM under `source = "domain_search"`. The hosting
page shows three F2-managed tiers (฿299 / ฿599 / ฿1,499 per month) with a
monthly/annual toggle. Two new service lines appear in the catalogue:
**Cloud & VPS** (managed DigitalOcean) and **DevOps & CI/CD** (GitHub
Actions). The header gained an "Infrastructure" dropdown; the footer now
lists THNIC, ResellerClub, DigitalOcean, Microsoft 365, and SiS as
accreditations. Admin gets a `/admin/pricing` read-only view. All copy ships
in both English and Thai.

---

## What shipped

### DBA — `013_infra.sql`

- New `domain_pricing` table (registry: `thnic` | `resellerclub`,
  privacy_included, is_thai_only, JSONB notes for EN/TH).
- New `hosting_plans` table (JSONB name/tagline/bandwidth_label, perks as
  `{en: [...], th: [...]}`, monthly + annual prices, sites/emails 0 = unlimited).
- Two new `services` rows: `cloud-infrastructure` (sort 35, icon `Cloud`)
  and `devops-cicd` (sort 36, icon `GitBranch`) with full EN+TH copy.
- `leads.source` CHECK extended to include `domain_search` and
  `hosting_request`.
- `pages` row for `about` UPDATE-d to mention THNIC + DigitalOcean
  partnerships in both EN and TH bodies.
- 8 domain TLDs seeded (3 THNIC at ฿890, 5 RC: .com ฿420, .net/.org ฿520,
  .biz ฿620, .asia ฿720). 3 hosting plans seeded (Starter ฿299, Professional
  ฿599 — featured, Resort ฿1499 unlimited).

### Backend — `cms-api` extension

- New types `DomainPricing` and `HostingPlan` in
  `services/cms-api/internal/models/cms.go`.
- New handlers `ListDomainPricing` and `ListHostingPlans` in
  `services/cms-api/internal/handlers/cms.go`, both using
  `mw.LocaleFrom(r.Context())` + `COALESCE(col->>$1, col->>'en')` so EN/TH
  is resolved on the backend.
- Routes wired in `services/cms-api/cmd/server/main.go`:
  - `GET /api/cms/domain-pricing`
  - `GET /api/cms/hosting-plans`
- Build clean, vet clean.

### Frontend — public pages

- `/[locale]/domains/page.tsx` (server) + `DomainsClient.tsx` (client) —
  hero, search box, contact form, pricing tables grouped by registry, CTA.
- `/[locale]/hosting/page.tsx` (server) + `HostingClient.tsx` (client) —
  hero with `From ฿299/month` rollup, monthly/annual toggle, 3 tier cards
  with featured ring on Professional, perks list, "Beyond the plans"
  section, CTA to Cloud & VPS service.
- `Header.tsx` — refactored to support nav groups; "Infrastructure"
  dropdown now contains Domains + Hosting (desktop hover; mobile section
  header).
- `Footer.tsx` — added Domains + Hosting to Explore column, replaced
  layout to add a 4th "Partners & accreditations" column listing THNIC,
  ResellerClub, DigitalOcean, Microsoft 365, SiS.
- `lib/icons.tsx` — registered `Cloud` and `GitBranch` for the two new
  service icons.
- `lib/api.ts` — added `DomainPricingItem` + `HostingPlanItem` types and
  `cms.listDomainPricing(locale)` + `cms.listHostingPlans(locale)` server
  helpers (revalidate 60s, Accept-Language forwarded).

### Frontend — admin

- `/[locale]/admin/pricing/page.tsx` — Domains + Hosting tabs, read-only
  tables. Includes an info banner noting that edits are made via DB
  migration (no admin CRUD UI yet).
- `AdminShell.tsx` nav extended with "Pricing" entry (DollarSign icon,
  not admin-only).

### Messages

- `messages/en.json` and `messages/th.json` extended with parity:
  - `header.nav.infrastructure` + `domains` + `hosting`
  - `footer.exploreLinks.domains` + `hosting`
  - `footer.partners.{title, lines[]}`
  - `domains.*` (~30 keys)
  - `hosting.*` (~25 keys, including `compare.items[]` array)
  - `admin.shell.nav.pricing` + `admin.pricing.*` (~25 keys)

### Lead capture

- Domain search box submits to `POST /api/leads/` with
  `source: "domain_search"` and the typed query embedded in the message.
  CHECK constraint accepts the new value (verified — HTTP 201 from smoke).

---

## Smoke matrix — all pass

| # | Check | Result |
|---|---|---|
| 1 | `GET /api/cms/domain-pricing` returns 8 rows | ✅ 8 |
| 2 | `GET /api/cms/domain-pricing?locale=th` returns Thai notes | ✅ "สำหรับนิติบุคคลไทย…" |
| 3 | `GET /api/cms/hosting-plans` returns 3 plans with perks array | ✅ |
| 4 | `/domains` returns 200 (EN) | ✅ |
| 5 | `/th/domains` returns 200 with Thai hero | ✅ "จดโดเมน อย่างถูกต้องและครบมือ" |
| 6 | `/hosting` returns 200 (EN) | ✅ |
| 7 | `/th/hosting` returns 200 (TH) | ✅ |
| 8 | `/services/cloud-infrastructure` returns 200 | ✅ |
| 9 | Header "Infrastructure" label renders in EN | ✅ |
| 10 | Header "โครงสร้างพื้นฐาน" label renders in TH | ✅ |
| 11 | Footer "Partners & accreditations" / "พาร์ทเนอร์และการรับรอง" | ✅ |
| 12 | `POST /api/leads/` with `source:"domain_search"` | ✅ HTTP 201 |
| 13 | `tsc --noEmit` clean | ✅ |
| 14 | `cms-api` `go build` + `go vet` clean | ✅ |

---

## Live access

| URL | Notes |
|---|---|
| <http://localhost/domains> | TLD pricing + lead capture (EN) |
| <http://localhost/th/domains> | TLD pricing + lead capture (TH) |
| <http://localhost/hosting> | 3-tier comparison (EN) |
| <http://localhost/th/hosting> | 3-tier comparison (TH) |
| <http://localhost/services/cloud-infrastructure> | New service detail |
| <http://localhost/services/devops-cicd> | New service detail |
| <http://localhost/admin/pricing> | Admin read-only view (requires staff JWT) |

---

## Caveats and follow-ups

- **Admin pricing is read-only.** Edits today require a DB migration
  (or ad-hoc `psql`). A full CRUD admin UI is a clear next phase.
- **No live TLD availability lookup.** The search box captures intent and
  drops a lead — F2 staff manually checks availability and replies. A
  real WHOIS / registry-API integration is a future enhancement once
  THNIC and ResellerClub credentials are in production.
- **Hosting plan "Request this plan" links** route to `/contact` with a
  `?service=` query, not a direct checkout. F2 quotes manually.
- **CTA from hosting → Cloud & VPS** uses the `services/{slug}` page,
  which is consistent with the existing site model.
- **Thai content is Claude-drafted.** F2 should review `messages/th.json`
  domains/hosting blocks and migration `013_infra.sql` Thai strings.

---

## Tracker — recommended follow-ups

| # | Item | Effort |
|---|---|---|
| 1 | Admin CRUD for `domain_pricing` + `hosting_plans` (auth-gated mutations on cms-api) | M |
| 2 | Live WHOIS / availability check on domain search (THNIC + ResellerClub APIs) | L |
| 3 | "Order this hosting plan" PayPal / promptpay flow (for ฿299 / ฿599 self-serve tier) | L |
| 4 | F2 review pass on Thai phrasings (messages + migration UPDATEs) | S |
| 5 | Add "Cloud & VPS" and "DevOps & CI/CD" rows to the case-study `services_used` allowlist when those engagements ship | S |
