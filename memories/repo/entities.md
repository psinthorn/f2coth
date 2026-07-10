# F2 Website — Entities

**Last verified:** 2026-07-04 (post-E2E sweep). Read this to know what real customers, services, and modules exist before proposing anything new. Cross-check the DB (`docker exec f2-postgres psql`) before acting on any name — this file drifts.

**Real projects seeded:** "Miskawaan IT — Audit & Weekly Maintenance" (linked to Miskawaan Beachfront Villas, all 12 templates attached, 78 items). Plus one admin-created "IT Full System Audit" (unlinked).

**Live E2E baseline:** `bash services/checklist-api/e2e/checklist_e2e.sh` → 50 PASS / 0 FAIL. Any deviation means a regression.

---

## Client accounts (customers table)

| Name                          | Slug                  | Industry                    | Notes                                              |
|-------------------------------|-----------------------|-----------------------------|----------------------------------------------------|
| Miskawaan Beachfront Villas   | miskawaan-villas      | Ultra-Luxury Private Villas | First checklist-api client (IT audit + weekly SLA) |
| Putahracsa Hua Hin            | putahracsa-hua-hin    | Boutique Luxury Resort      |                                                    |
| SALA Hospitality Group        | sala-hospitality      | Luxury Hotels & Resorts     |                                                    |
| F2 SANDBOX TEST               | sandbox-test          | sandbox                     | Test-mode account, do not use for real projects    |

Each `customers` row can have N `customer_contacts` (portal login accounts, JWT `aud=customer` + `customer_id` claim). Contacts are the identity that logs into `/portal/*`.

---

## Service catalogue (services table)

Managed via `/admin/services`. Public list: `/services`. Slug + JSONB (en/th) title/summary/description.

Currently ships: domain-hosting, managed-hosting, private-cloud, cloud-storage, backup-recovery, cybersecurity, cctv-surveillance, network-wifi, digital-signage, hospitality-tech, professional-services, corporate-support. Confirm against DB before assuming — this list moves.

---

## Module registry (modules table = /admin/features)

**48 modules across 4 areas.** Every UI feature is toggleable. If you're adding a new feature and don't insert a row here, the AdminShell nav gate will hide it.

- **public** (12): home, about, services, case_studies, blog, products, domains, hosting, contact, terms, privacy, dpa
- **portal** (7): login, dashboard, tickets, domains, sla, **projects**, billing
- **admin** (26): dashboard, app_mode, leads, tickets, customers, orders_domains, blog, home_content, pages, services, case_studies, dsr, pricing, invoices, payments, payment_methods, subscriptions, refunds, bank_imports, disputes, suspensions, users, features, **projects**, **contracts**
- **api** (14): auth, consent, leads, dsr, cms, chat, notifications, reseller, portal, payment, payment_scheduler, **checklists**, **contracts**, **docgen** (service.docgen)

Bold = added by migrations 038–040 (checklist-api) and 054 (contracts). `core=true` items (login, home, dashboard, contact, terms, privacy, users, features, portal.login/dashboard) cannot be toggled off from the UI.

Read the live list any time with:

```sql
SELECT area, key, name_en, enabled FROM modules ORDER BY area, sort_order;
```

---

## Project / checklist entities (this iteration)

- **checklist_templates** (12 seeded, codes A–L) — reusable audit modules. A: Project Kickoff · B: Network & Internet · C: Wi-Fi · D: CCTV · E: Server/NAS · F: Backup & DR · G: Endpoints · H: Email & M365 · I: Security & Accounts · J: Weekly Visit · K: Monthly Reporting · L: Close-out & Handover
- **checklist_template_items** (78 seeded across the 12 templates, bilingual)
- **projects** — one row per client engagement. `client_name` free-text fallback; `customer_id` nullable FK to `customers`; `visible_to_customer` gates portal exposure; `iacc_company_id` reserved for future iACC integration
- **project_modules** — attached templates on a project, ordered by `position` (drag-drop)
- **project_items** — snapshot copy at attach time; status ∈ {pending, pass, fail, na}
- **visit_logs** — weekly visit records; `billable` + `amount` are the iACC bridge

---

## Contract entities (migrations 054–055, contract-api)

- **contract_templates** (2 seeded) — `service-agreement` (doc_prefix F2-AGR, 11 merge fields) + `mutual-nda` (F2-NDA, 7 fields). `code` maps 1:1 to a **docgen builder** (`services/docgen/lib/builders/`); admin can edit name/version/`merge_schema` defaults + toggle active but NOT the code/layout (layouts are code-defined; validated vs docgen `GET /templates`).
- **contract_parties** — the customer/legal entity on a contract (legal_name_en/th, tax_id, address, notice_email…). Optional FK to `customers` (a party may link a portal account without needing one). Separate table, **not** an extension of `customers`.
- **contracts** — one agreement. `doc_no` = `F2-<prefix>-<year>-<seq>` from `contract_doc_seq` (concurrency-safe). Status ∈ {draft→sent→signed→active→expired/terminated}, server-enforced (illegal jumps → 409). `project_id` nullable FK to `projects`. `merge_data` JSONB snapshot.
- **contract_files** — metadata only (kind ∈ generated_docx/generated_pdf/signed_scan). Bytes on the **contract-uploads volume**, never in Postgres. 20 MB cap.
- **contract_status_events** — status timeline / audit trail.
- **iacc_outbox** — invoice-draft payload queued on status→active (drain worker TBD).

---

## Shared user identity

- `users.role ∈ {admin, editor, viewer}` — staff. Editor = tech (can update item status, add visit logs). Viewer = read-only.
- `customer_contacts.role` — contact-level role within a customer org (primary/billing/etc). Not the same as staff role.

---

## Where each domain lives (jump-map)

- Public marketing content: cms-api + `web-app/src/app/[locale]/*/page.tsx` (non-admin, non-portal)
- Lead capture: `/api/leads` + `web-app/src/app/[locale]/contact`
- Chatbot: ai-chat-api + `web-app/src/components/ChatWidget.tsx`
- Customer portal: customer-api + payment-api + checklist-api + `web-app/src/app/[locale]/portal`
- Admin console: every service's `/admin/*` endpoints + `web-app/src/app/[locale]/admin`
- Feature toggles: cms-api owns the `modules` table (yes, cross-domain — it was there first)
- Auth: auth-api handles both `POST /api/auth/login` (staff) and `POST /api/auth/customer/login` (portal)
