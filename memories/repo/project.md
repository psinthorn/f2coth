# F2 Website — Repo Snapshot

**Last verified:** 2026-07-04 (production-ready + Cloudflare playbook) · 44 migrations, 52 tables, 10 services · checklist-api E2E baseline: 50/50 green, stack health 10/10. **All 8 SEO audit gaps closed. All 7 production-readiness blockers cleared** (CI/CD + scheduler + upload quota + SMTP encryption + OG fonts + observability + backups). Edge topology recommended: **Cloudflare Free plan in front of the VPS** — playbook at [docs/cloudflare-setup.md](../../docs/cloudflare-setup.md). See [docs/production-readiness.md](../../docs/production-readiness.md) for the go-live sequence.

Load this before doing anything so you don't reinvent a service, table, route, or component that already exists. Cross-check against `/admin/features` (the live module registry) for the current on/off state.

---

## Services

| Service          | Port | Traefik prefix     | Owns                                                                 |
|------------------|------|--------------------|----------------------------------------------------------------------|
| cms-api          | 8001 | /api/cms           | services, blog, case studies, pages, home, pricing, hosting, modules |
| lead-api         | 8002 | /api/leads         | contact form, lead CRM, consent, client IP                           |
| ai-chat-api      | 8003 | /api/chat          | Claude sonnet-4-6 chatbot                                            |
| auth-api         | 8004 | /api/auth          | staff + customer JWT (aud=customer for portal), users, refresh, DSR  |
| notification-api | 8005 | /api/notifications | email worker (SMTP)                                                  |
| customer-api     | 8006 | /api/customer      | customers, contacts, tickets, SLA, domains, billing profile          |
| reseller-api     | 8007 | /api/reseller      | domain availability + ordering (ResellerClub, THNIC)                 |
| checklist-api    | 8008 | /api/checklists    | project boards, checklist templates, visit logs, portal read-view    |
| payment-api      | 8010 | /api/payment       | invoices, payments, subs, refunds, disputes, dunning, suspensions    |
| web-app          | 3000 | /                  | Next.js 16 · App Router · TS · Tailwind · next-intl (en/th)          |

Payment-api runs on 8010 (customer-api took 8006 before payment was split). **Don't put a new service on 8006, 8009, or reuse any allocated port.** Next free: 8011+.

---

## JWT audiences (critical for gate design)

- Staff tokens: no `aud` claim, `role ∈ {admin, editor, viewer}`
- Customer portal tokens: `aud="customer"`, plus `customer_id` claim (contact's parent org)

Any new service that gates on identity **must** distinguish these — a staff `RequireAdmin` middleware will silently reject customer tokens (good) but a naive "role != empty" check will let admins into portal endpoints (bad). See `services/checklist-api/internal/middleware/auth.go` for the canonical pattern (`RequireAuth`, `RequireStaff`, `RequireAdmin`, `RequireCustomer`).

---

## Migrations (numeric log — canonical order)

001 extensions · 002 auth (users, refresh, login_events) · 003 cms (services, case_studies, blog, media, hosting_plans, pages) · 004 leads + activities · 005 chat sessions/messages · 006 notifications + templates · 007 seed data · 008 admin v1 · 009 customers + contacts + tickets · 010 customer_assets/domains · 011 i18n JSONB conversion · 012–017 pricing/domain-orders/SLA/billing-profile · 018 dsr_audit_log → 019 modules + audit_log (generic) · 020 remove Bangkok office · 021–031 payments stack (invoices, methods, settings, PayPal, slip files, tax invoice, subs, refunds, bank imports, disputes, dunning) · 032 service_suspensions · 033 home_page_content · 034 fix i18n double nesting · 035 admin_pages_and_dpa_seed · 036 admin editable page heroes · 037 app_mode · **038 projects_checklists** · **039 checklist_seed (12 templates, 78 items)** · **040 projects_customer_link (customer_id FK + visible_to_customer + portal.projects module)**

(041–052 added since this list was last curated — read `database/migrations/` for the authoritative sequence) · **053 attachments (polymorphic `attachments` table: multi-doc / multi-image / geo-tagged live-photo BYTEA storage for tickets + projects; `api.attachments` module toggle)**

Next migration number: **054_*.sql**.

All migrations are idempotent (`CREATE TABLE IF NOT EXISTS`, `ON CONFLICT DO NOTHING`). Re-run via `make migrate`.

---

## Tables (50 — grouped)

- **Auth:** users, refresh_tokens, login_events, customer_contacts, customer_refresh_tokens
- **Content (cms-api):** services, blog_posts, case_studies, pages, home_page_content, media_assets, hosting_plans, domain_pricing, app_config
- **Leads:** leads, lead_activities, cookie_consents, data_subject_requests
- **Customers / portal:** customers, tickets, ticket_messages, customer_domains, customer_sla_contracts, customer_billing_profiles
- **Chat:** chat_sessions, chat_messages
- **Notifications:** notifications, notification_templates
- **Modules + audit:** modules (the toggle registry), audit_log (generic)
- **Payments:** invoices, invoice_items, payments, payment_methods_config, payment_slip_files, payment_webhook_events, subscriptions, refunds, bank_statement_imports, bank_statement_rows, payment_disputes, dunning_reminders, service_suspensions
- **Domains:** domain_orders, domain_availability_cache
- **Projects & checklists (this iteration):** checklist_templates, checklist_template_items, projects, project_modules, project_items, visit_logs

Foreign keys converge on `users.id` (staff) and `customers.id` (org). `project_items` snapshots template items at attach time so template edits don't rewrite in-flight audits — do not JOIN `project_items` back to templates.

---

## Route topology (public URL → service)

- `/api/cms/*` cms-api · `/api/leads/*` `/api/consent/*` lead-api · `/api/chat/*` ai-chat-api
- `/api/auth/*` auth-api (staff + customer login share one service) · `/api/notifications/*` notification-api
- `/api/customer/*` customer-api · `/api/reseller/*` reseller-api
- `/api/checklists/*` checklist-api (three gate groups: `/templates`, `/projects/*` = staff; `/portal/*` = customer; `/admin/*` = admin-only)
- `/api/payment/*` payment-api

Frontend groups (Next App Router):

- `/[locale]/` — public marketing pages (about, services, case-studies, blog, contact, terms, privacy, dpa, hosting, domains, products)
- `/[locale]/admin/*` — staff console, wrapped in `AdminShell`; nav items filtered by `modules` table
- `/[locale]/portal/*` — customer portal, wrapped in `PortalShell`; separate token bucket (`f2_portal_access_token`)
- `/[locale]/payments/paypal/{return,cancel}` — PayPal callback

---

## Conventions (do not violate)

1. **UUID PKs, TIMESTAMPTZ, `set_updated_at` trigger** on any table with mutable rows.
2. **Module toggle every new feature** — insert into `modules` (area ∈ public/portal/admin/api), let AdminShell's gate filter it. Never hard-code a feature into the nav.
3. **Bilingual always** — every UI feature ships both `messages/en.json` and `messages/th.json` keys. `make i18n-check` gates CI. Currently **1681 keys** each side.
4. **Prior-art check before writing** — grep existing handlers/components/tables. Tag additions REUSE / EXTEND / NEW.
5. **JWT gates layered** — three staff gates (`RequireAuth`, `RequireStaff`, `RequireAdmin`) + one customer gate (`RequireCustomer` on `aud=customer`). Match your gate to the scope, don't invent new ones.
6. **Docker compose adds:** both `docker-compose.yml` (dev, Traefik `entrypoints=web`) and `docker-compose.prod.yml` (websecure + letsencrypt + GHCR image). Also add to `Makefile` SERVICES list.
7. **Frontend API clients:** `admin-api.ts` for staff, `portal-api.ts` for customer, plus per-domain helpers (`checklist-api.ts`). Each reuses the same auth pattern — don't fork the fetch wrapper.
8. **Design system:** navy #1e293b, accent #7c3aed, white cards, rounded-xl, mobile-first, `card` utility class.
9. **Migration numbering strictly monotonic** — read `database/migrations/` and use next N.

---

## Common commands

```bash
make up                # dev stack (Traefik on :80, Postgres on :5432)
make prod-up           # production overlay (TLS + GHCR pulls)
make migrate           # re-apply all migrations idempotently
make ci                # tidy + fmt + test + i18n-check + modulegate sync check
make test              # go test across all services + pkg/modulegate
make i18n-check        # EN ↔ TH parity gate
docker exec f2-postgres psql -U f2 -d f2_website

# Live-stack E2E probes (each script exits with the number of failed checks;
# 0 = green baseline. Mints its own JWT from .env's JWT_SECRET).
bash services/checklist-api/e2e/checklist_e2e.sh   # 50 checks — templates/projects/board/items/photos/reports/portal/summary
```

---

## Open roadmap items

- **iACC integration** (see `services/checklist-api/internal/iacc/`) — stub only. Push monthly billable visits → invoice drafts via iACC REST API.
- **Photo storage for checklist items** — `project_items.photo_url` is URL-only; no `/uploads` endpoint yet.
- **Playwright browsers not installed** — `npx playwright install chromium` required before `npm run test:e2e`.
- **`memories/repo/agents.md`** not yet written (referenced by CLAUDE.md); agent-pipeline docs live in `ai/prompts/` for now.
