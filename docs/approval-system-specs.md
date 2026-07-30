# Approval System — Specification

**Status:** Draft for build · **Owner:** F2 platform · **Created:** 2026-07-30
**Seeded from:** ticket quotations (materials / labour) → generalises to any section needing customer sign-off.

This spec defines a **reusable Approval primitive**: F2 staff assemble something a customer must approve (a quotation, a resolved issue, a cost estimate), email the customer a link, and the customer approves or declines — with a full audit trail. It is designed once and embeddable in **any** section (tickets first; contracts / checklists / invoices later).

> Prior-art research confirmed **no approval/e-signature primitive exists today**. The nearest analogs are the contract state machine (`contract-api`) and the domain-orders `quoted → approved` enum — both staff-driven, neither customer-facing. We are building new, reusing existing infrastructure heavily.

---

## 1. Locked product decisions

| # | Decision | Choice |
|---|---|---|
| 1 | **Customer auth to approve** | **Magic-link, no login.** Single-use, expiring tokenised link (DSR pattern). Opens a scoped public approval page; no portal password needed. If the customer *is* logged in, the decision is also tied to their contact. |
| 2 | **"Multi-approve" meaning** | **One request bundles many items.** An approval request holds multiple items (quotation lines, issues, files) reviewed and approved together as **one whole-bundle decision**. One approver. |
| 3 | **On approval of a quotation** | **Unlock invoice, staff generates.** A quotation approval is *required* before `GenerateInvoice` is allowed; on approval the existing "Generate invoice" action unlocks. Human stays in the loop. |
| 4 | **Decline path** | **Approve or Decline with required reason.** A decline notifies staff, writes audit, and flags/reopens the ticket for revise-and-resend. |

Non-goals (v1): in-app cryptographic e-signature (approval is legally click-wrap consent + audit trail); per-item partial approval; multiple approvers; payment collection (unchanged — handled by `payment-api` after the invoice is issued).

---

## 2. Architecture at a glance

```
┌─ Admin (staff, JWT) ────────────┐        ┌─ Customer ─────────────────────────────┐
│ <ApprovalSection subjectType    │        │ (A) Magic-link  → /[locale]/approve/    │
│   subjectId customerId />        │        │      [token]  (public, no login)        │
│  • build request + items         │  email │ (B) Portal      → /portal/approvals/[id]│
│  • attach files                  │ ─────► │      (logged in)                        │
│  • send / resend / cancel        │  link  │  → Approve  /  Decline + reason          │
└──────────────┬───────────────────┘        └───────────────┬─────────────────────────┘
               │                                             │
        customer-api  (owns tickets, portal, attachments, approvals)
               │  approvals · approval_items · approval_tokens
               ▼
   audit_log · notification-api (email) · attachments (owner_type='approval')
   quotation approval → gates ticket GenerateInvoice → payment-api draft invoice
```

**Where it lives:** `customer-api`. Rationale: the first (and only v1) subject is the ticket, and tickets, portal, billing, and attachments all already live in `customer-api` — housing approvals here avoids cross-service calls for subject context. The tables are **polymorphic** (`subject_type`, `subject_id`) so contracts/checklists can adopt them later; if a second *service* needs to write approvals we extract an `approval-api` then (see §12 Phase 3). This mirrors the existing house style: `attachments` and `audit_log` are both soft-polymorphic single tables.

---

## 3. Data model — migration `075_approvals.sql`

Money is `BIGINT` minor units (satang), VAT in basis points (700 = 7%), matching `ticket_line_items` / `invoices`. Soft-polymorphic `(subject_type, subject_id)` with **no FK**, matching `attachments` (migration 053) and `audit_log` (019).

### 3.1 `approvals` — the request

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | `gen_random_uuid()` |
| `subject_type` | TEXT NOT NULL | CHECK IN (`'ticket'`) — extend via ALTER in future migrations |
| `subject_id` | UUID NOT NULL | soft ref to the subject (e.g. `tickets.id`); no FK |
| `customer_id` | UUID NOT NULL | FK `customers(id)` ON DELETE CASCADE — **tenant isolation boundary**, denormalised for fast portal filtering |
| `kind` | TEXT NOT NULL DEFAULT `'general'` | CHECK IN (`'quotation'`,`'resolution'`,`'general'`). `quotation` gates invoicing; `resolution` = approve a resolved issue |
| `status` | TEXT NOT NULL DEFAULT `'draft'` | CHECK IN (`'draft'`,`'sent'`,`'approved'`,`'declined'`,`'cancelled'`,`'expired'`) |
| `title` | TEXT NOT NULL | e.g. "Quotation for materials — Ticket #123" |
| `body_md` | TEXT NOT NULL DEFAULT `''` | staff message (markdown; reuse `MarkdownEditor` / `CMSPageBody`) |
| `currency` | TEXT | CHECK IN (`'THB'`,`'USD'`); NULL for non-priced |
| `subtotal_cents` | BIGINT NOT NULL DEFAULT 0 | **snapshot** frozen at send |
| `vat_rate_bp` | INT NOT NULL DEFAULT 700 | |
| `vat_cents` | BIGINT NOT NULL DEFAULT 0 | |
| `total_cents` | BIGINT NOT NULL DEFAULT 0 | the number the customer approves |
| `requested_by_user_id` | UUID | FK `users(id)` — staff who sent |
| `decided_by_contact_id` | UUID | FK `customer_contacts(id)` — who decided (from token binding or portal session) |
| `decided_via` | TEXT | CHECK IN (`'magic_link'`,`'portal'`) |
| `decided_at` | TIMESTAMPTZ | |
| `decline_reason` | TEXT | required when declined |
| `sent_at` | TIMESTAMPTZ | |
| `expires_at` | TIMESTAMPTZ | approval validity (default now + 14 days) |
| `created_at` / `updated_at` | TIMESTAMPTZ | `updated_at` trigger `set_updated_at` |

Indexes: `(subject_type, subject_id)`, `(customer_id, status)`, `(status, expires_at)`.

### 3.2 `approval_items` — the bundle

One row per item shown to the customer. Whole-bundle decision, so **no per-item status**.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `approval_id` | UUID NOT NULL | FK `approvals(id)` ON DELETE CASCADE |
| `item_type` | TEXT NOT NULL | CHECK IN (`'line'`,`'issue'`,`'text'`). `line` = priced quotation line snapshot |
| `ref_type` / `ref_id` | TEXT / UUID | optional provenance (e.g. `ticket_line_item` → `ticket_line_items.id`) |
| `label` | TEXT NOT NULL | line/issue title |
| `detail_md` | TEXT | optional description (markdown) |
| `quantity` | INT | for `line` |
| `unit` | TEXT | for `line` |
| `unit_price_cents` | BIGINT | snapshot |
| `amount_cents` | BIGINT NOT NULL DEFAULT 0 | snapshot (0 if covered/non-priced) |
| `sort_order` | INT NOT NULL DEFAULT 0 | |
| `created_at` | TIMESTAMPTZ | |

**Files** are NOT an item_type — they attach to the approval via the existing attachments table (§3.4).

### 3.3 `approval_tokens` — magic-link (DSR / `password_resets` pattern)

Separate table (not overloading `password_resets`) because a token is bound to a **resource** (the approval) and we need resend-with-revoke.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `approval_id` | UUID NOT NULL | FK `approvals(id)` ON DELETE CASCADE |
| `contact_id` | UUID NOT NULL | FK `customer_contacts(id)` — the emailed recipient; **identifies the approver for no-login decisions** |
| `token_hash` | TEXT NOT NULL UNIQUE | sha256 hex of the raw 64-char token (raw token only ever in the URL, never stored) |
| `expires_at` | TIMESTAMPTZ NOT NULL | |
| `used_at` | TIMESTAMPTZ | stamped when a decision is made (single-use **for deciding**; viewing does not burn it) |
| `revoked_at` | TIMESTAMPTZ | set on resend/cancel to invalidate prior tokens |
| `ip_address` | INET | captured at decision (as `password_resets` does) |
| `user_agent` | TEXT | |
| `created_at` | TIMESTAMPTZ | |

Token generation reuses the canonical helper (`mintToken()` in `auth-api/.../password_reset.go:69`, duplicated in `customer-api/.../contacts_invite.go:53`): 32 bytes `crypto/rand` → hex; store `sha256Hex` only; redeem by hashing the inbound token and matching. **Extract this into `customer-api` for approvals** (or copy per the existing repo convention).

### 3.4 Attachments — extend `owner_type`

Migration alters the CHECK on `attachments` (053) to add `'approval'`:

```sql
ALTER TABLE attachments DROP CONSTRAINT attachments_owner_type_check;
ALTER TABLE attachments ADD  CONSTRAINT attachments_owner_type_check
  CHECK (owner_type IN ('ticket','ticket_message','project','project_item','visit_log','approval'));
```

Then in `customer-api/internal/handlers/attachments.go`: add `'approval'` to `customerOwnerTypes` and a resolver case in `ownerCustomer` (approval → `approvals.customer_id`). No web-app client change (the `attachments-api.ts` clients take `ownerType: string`).

### 3.5 Module rows (seeded in `075`, `ON CONFLICT DO NOTHING`)

| key | area | purpose |
|---|---|---|
| `api.approvals` | api | gates all approval endpoints incl. the public magic-link routes |
| `admin.approvals` | admin | the `ApprovalSection` admin UI |
| `portal.approvals` | portal | the portal approvals list/detail (logged-in path) |

The `/admin/features` page buckets by `area` automatically — no code change to surface these.

---

## 4. State machine

```
 draft ──send──▶ sent ──approve──▶ approved   (terminal)
   │              │  ├─decline──▶ declined  ──staff revise──▶ (new approval, or resend→sent)
   │              │  ├─expire───▶ expired    (lazy on read + nightly sweep)
   │              │  └─cancel───▶ cancelled  (staff, terminal)
   └──delete (draft only)
```

Transitions are enforced server-side (mirror `contract-api/status.go` `CanTransition`). A **decision is only accepted when `status='sent'`** and the token is valid/unused/unexpired. Re-sending a `declined` or `sent` approval mints a fresh token, revokes prior tokens, re-freezes the snapshot, and returns to `sent`.

**Snapshot immutability:** editing items/totals is allowed only while `draft`. `send` freezes `subtotal/vat/total` + the `approval_items` set. If staff need to change an approved/sent quote, they cancel/supersede and create a new approval — the customer never approves a figure that later silently changes.

---

## 5. Backend API (customer-api)

### 5.1 Admin (staff JWT · `GateModule("api.approvals")`)
Base: `/customer/admin/approvals`

| Method + path | Purpose |
|---|---|
| `POST /` | Create draft `{subject_type, subject_id, kind, title, body_md, currency?, items[], expires_in_days?}`. For `kind='quotation'` + `subject_type='ticket'`, if `items` omitted, prefill from the ticket's non-covered `ticket_line_items` (snapshot). |
| `GET /?subject_type=&subject_id=` | List approvals for a subject (admin view, all statuses). |
| `GET /{id}` | Detail (request + items + token status + decision + attachments). |
| `PATCH /{id}` | Edit (draft only). |
| `DELETE /{id}` | Delete (draft only). |
| `POST /{id}/send` | `{contact_id, expires_in_days?}` → freeze snapshot, mint token, revoke prior, enqueue `approval_request_customer` email, `status→sent`, `sent_at=now`. |
| `POST /{id}/resend` | new token + re-email (revokes prior). |
| `POST /{id}/cancel` | `status→cancelled`. |

### 5.2 Portal (customer JWT · `GateModule("api.approvals")`) — logged-in path
Base: `/portal/approvals`

| Method + path | Purpose |
|---|---|
| `GET /` | List my org's approvals (filter by `customer_id` from JWT; hide `draft`). |
| `GET /{id}` | Detail (tenant-checked). |
| `POST /{id}/decide` | `{decision: 'approved'\|'declined', reason?}` (reason required on decline). `decided_via='portal'`, `decided_by_contact_id=contactID`. |

### 5.3 Public — magic-link (NO JWT; token is the credential · `GateModule("api.approvals")`)
Base: `/api/approvals/link` — a new **unauthenticated route group** in `customer-api/cmd/server/main.go` (precedent: auth-api DSR `GET /api/privacy/dsr/verify`).

| Method + path | Purpose |
|---|---|
| `GET /{token}` | Resolve token → approval view payload (title, body, items, totals, file metadata, expiry, current status, org name). **Does not burn the token.** Generic 404 on bad/expired/revoked to prevent enumeration. |
| `GET /{token}/files/{fileId}` | Token-scoped stream of an approval attachment (the only way to fetch approval files without a portal session). |
| `POST /{token}/decide` | `{decision, reason?}` → validate token (unused, unexpired, `status='sent'`), stamp `decided_*` from `token.contact_id`, burn token (`used_at`), transition status, write audit, enqueue staff email. **Idempotent:** if already decided, returns the current terminal state rather than erroring. |

### 5.4 Quotation → invoice gate (EXTEND existing billing)
- Extend the `TicketBilling` response (`ticket_billing.go` `buildBilling`) with `approval_status` + `approval_id` (latest `kind='quotation'` approval for the ticket).
- `GenerateInvoice` (`ticket_billing.go:387`) **rejects with 409** unless a `kind='quotation'` approval for the ticket is `approved` (skip the gate when `billing_status` never needed a quote — configurable; default: gate only when a quotation approval exists or `billing_status='billable'` per policy in §11). No new `tickets` column — the gate is query-based to avoid drift.
- On **decline** of a ticket quotation: enqueue `approval_declined_staff`, write an internal `ticket_messages` note (`internal=true`) with the reason, and set ticket `status='in_progress'` (revise-and-resend loop).

---

## 6. Email (notification-api — reuse enqueue contract)

Producers POST `/api/notifications/` (or use `notify.Client.Send`) with a template code + `payload` + `locale`. New `notification_templates` rows seeded (bilingual JSONB `subject_tmpl`/`body_tmpl`, `en` required) in migration `075` (or a paired `076_approval_emails.sql`):

| template code | to | key payload vars |
|---|---|---|
| `approval_request_customer` | customer contact | `{contact_name, title, total, currency, expires_on, approval_url}` where `approval_url = {PortalBaseURL}/{locale}/approve/{rawToken}` |
| `approval_approved_staff` | assignee / sales | `{title, customer_name, decided_by, decided_at, subject_url}` |
| `approval_declined_staff` | assignee / sales | `{title, customer_name, decided_by, reason, subject_url}` |
| `approval_reminder_customer` *(Phase 2)* | customer contact | reminder before `expires_at`; scheduled via `notifications.scheduled_at` |

The request email is the **only** approval email carrying a magic-link. Attachments can ride along via `payload._attachments[]` if a PDF quote is generated (Phase 2).

---

## 7. Frontend

### 7.1 Reusable primitive — `ApprovalSection` (the "approval section visible to any section")
`services/web-app/src/components/approvals/ApprovalSection.tsx`

```tsx
<ApprovalSection subjectType="ticket" subjectId={id} customerId={ticket.customer_id} defaultKind="quotation" />
```
Renders: list of approvals for the subject (status badges, totals, decision info) + a **builder** (title, `body_md` via `MarkdownEditor`, add items, attach files via `AttachmentUploader ownerType="approval"`, pick recipient contact, expiry) + send / resend / cancel. Drop into the admin ticket detail now; reuse verbatim in contract / checklist detail later. Register it in `reference_shared_components` memory on build.

Supporting shared bits: `ApprovalStatusBadge` (pill), `ApprovalItemsTable` (renders line/issue/text + totals), reused on admin, portal, and the public page.

### 7.2 Public magic-link page — `/[locale]/approve/[token]/page.tsx`
Standalone branded page (no `AdminShell`/`PortalShell`; precedent: `privacy/confirm`). Client component: reads `[token]`, `GET /api/approvals/link/{token}`, renders items/totals/files + **Approve** / **Decline (reason)** → `POST …/decide` → success / declined / already-decided / expired states. Public but module-gated; shows only what's needed (no broad customer PII).

### 7.3 Portal (logged-in) — `/[locale]/portal/approvals/` list + `[id]` detail
Uses `portalApi` (new methods in `portal-api.ts`). The detail page reuses `ApprovalItemsTable` and offers the same Approve/Decline controls (`decided_via='portal'`).

### 7.4 Ticket integration (Phase 1)
- Admin ticket detail: mount `<ApprovalSection subjectType="ticket" …/>` near `TicketBillingPanel`.
- `TicketBillingPanel`: disable "Generate invoice" until the quotation approval is `approved`; show the approval status inline (from the extended `TicketBilling` payload).
- `resolution`-kind approval can reference the ticket `solution` (ties into the existing `solution_shared` feature) — Phase 2 auto-close on approve.

### 7.5 API-layer types
`admin-api.ts`: `Approval`, `ApprovalItem`, `createApproval/listApprovals/getApproval/sendApproval/resendApproval/cancelApproval`.
`portal-api.ts`: `PortalApproval`, `listApprovals/getApproval/decideApproval`.
Public page calls a thin unauthenticated fetch (no bearer) to `/api/approvals/link/*`.

---

## 8. Security

- **Token:** 32-byte `crypto/rand` → 64 hex; store `sha256` only; default TTL 14 days (per-send override); single-use for the *decision*; bound to a specific `contact_id`; revoked on resend/cancel.
- **Enumeration:** public endpoints return a generic 404 for bad/expired/revoked/used tokens; add per-IP rate limiting on `/api/approvals/link/*`.
- **Tenant isolation:** portal endpoints filter by `customer_id` from the JWT; public endpoints scope via token → approval → customer; admin scoped to staff.
- **File access:** approval attachments are only downloadable via `/api/approvals/link/{token}/files/{id}` (token-scoped) or the authed portal/admin attachment serve — never public-by-id.
- **Audit:** `writeAudit(resource_type='approval', resource_id=id, action='sent'|'approved'|'declined'|'cancelled')`. **Caveat:** `audit_log.actor_id` FKs `users` (staff) only — for customer decisions pass `actorID=""` and record `{contact_id, email, decision, via, ip}` in the `changes` JSONB (existing customer-side precedent), or extend `writeAudit` to accept a contact actor (recommended, since approvals make F2 a "third caller" — the helper's own comment says extract-to-shared-pkg at that point).
- **Legal:** approval is click-wrap consent; we capture who/when/how/IP/UA + frozen snapshot. Not a cryptographic signature (explicit non-goal).

---

## 9. i18n

Bilingual EN+TH in the **same change** (CI `i18n-check` gate). New namespaces: `admin.approvals.*`, `portal.approvals.*`, `approve.*` (public page). Email bodies are bilingual in `notification_templates` (JSONB per-locale). Reuse `common.*` (priority, save, cancel, loading) and `common.markdown.*` (editor toolbar).

---

## 10. Audit & module wiring checklist

- [ ] `075` seeds `modules` (`api.approvals`, `admin.approvals`, `portal.approvals`).
- [ ] Backend route groups wrapped with `mw.GateModule("api.approvals")`.
- [ ] Admin page / portal page call `isModuleEnabled(...)`.
- [ ] `writeAudit` on every state transition.

---

## 11. Resolved policy (locked 2026-07-30)

1. **Invoice gate strictness — backward-compatible.** `GenerateInvoice` is gated **only when a `kind='quotation'` approval exists** for the ticket: if one exists it must be `approved` (else 409); if none exists, staff may invoice as today. This ships the gate without breaking existing billable tickets that never used a quote. A ticket can be made "quote-required" simply by creating a quotation approval on it.
2. **Expiry — lazy in Phase 1, swept in Phase 2.** On any read, a `sent` approval past `expires_at` is treated as `expired` and its token rejected. Phase 2 adds a nightly sweep that persists `sent`→`expired` and enqueues an internal notice.
3. **Staff email recipients — assignee → `SalesNotifyTo`.** Decision emails (`approval_approved_staff` / `approval_declined_staff`) go to the ticket assignee's address, falling back to `cfg.SalesNotifyTo`, matching `NotifyStaffOnNewTicket`.
4. **Resolution-kind on approve — record only in Phase 1.** Approving a `kind='resolution'` request records the decision + audit; auto-closing the ticket (`resolved`→`closed`) is deferred to Phase 2.
5. **Approver identity gating — any active contact.** In v1 any active, non-disabled contact the link is sent to may approve (the token is bound to that `contact_id`). Owner-vs-member restriction is available (via `contact_org_memberships.role`) but **not enforced** in v1; revisit if the business needs it.

*These are the build defaults; each is a small, localised policy that can be revisited without reshaping the schema.*

---

## 12. Delivery phases

**Phase 1 — MVP (tickets + quotation gate):** migration `075` (+ attachments ALTER, modules, email templates); `customer-api` admin + public + portal endpoints; token mint/verify; magic-link page; `ApprovalSection` on admin ticket detail; quotation-kind invoice gate; decline-with-reason loop; audit; EN/TH i18n. End-to-end, module-toggled, per the "ship end-to-end" mandate.

**Phase 2:** portal approvals list page; expiry sweep + reminder email (via `notifications.scheduled_at`); resolution-kind auto-close; quotation PDF (activate the dormant `invoices.doc_type='quotation'` + `invoice_pdf.go` renderer, or a standalone approval PDF); `_attachments` PDF on the request email.

**Phase 3 — generalise:** extend `subject_type` CHECK to `contract` / `project` / `invoice`; mount `ApprovalSection` in those sections; if a second *service* must write approvals, extract `approval-api` (or a shared `pkg/approvals`), moving the tables' ownership out of `customer-api`.

---

## 13. Prior-art reuse ledger (per the 4 hard rules)

| Concern | Verdict | Source |
|---|---|---|
| Magic-link token (mint/hash/expiry/single-use/no-login GET→redirect) | **REUSE** | DSR `auth-api/.../privacy.go` `VerifyDSR`; `mintToken()` `password_reset.go:69` |
| Email send (enqueue + bilingual DB templates + attachments) | **REUSE** | `notification-api` `POST /api/notifications/`; `notify.Client`; `notification_templates` |
| File attachments on the approval | **EXTEND** | `attachments` table → add `owner_type='approval'` (migration 053 pattern) |
| Quotation figures (lines, VAT 7%/700bp, satang, totals) | **REUSE** | `ticket_line_items` + `buildBilling` (`ticket_billing.go`), migration 073 |
| Invoice creation after approval | **REUSE** (gate it) | `GenerateInvoice` → `payment-api` draft invoice |
| Audit trail | **REUSE** (extend actor for contacts) | `audit_log` (019) + `writeAudit` (`audit.go`) |
| Module toggle | **REUSE** | `modules` + `pkg/modulegate` + `/admin/features` |
| Approver identity / owner-vs-member | **REUSE** | customer JWT (`contact_id`, `customer_id`) + `contact_org_memberships.role` (071) |
| Markdown authoring/rendering | **REUSE** | `MarkdownEditor` + `CMSPageBody` |
| State machine enforcement | **REUSE** (pattern) | `contract-api/status.go` `CanTransition` |
| The approval entity itself (tables, endpoints, magic-link page, `ApprovalSection`) | **NEW** | migration `075`, `customer-api/.../approvals.go`, `components/approvals/*` |

---

*End of spec. Ready to build Phase 1 on approval of §11 policy points.*
