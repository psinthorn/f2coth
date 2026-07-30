# User Account Management — Spec & Plan

**Status:** Draft for build · **Owner concept:** `customer_contacts` (portal user) → `customers` (organization)
**Prior-art verdict:** mostly **EXTEND** an existing system, not NEW. Staff `users` table is out of scope.

---

## 1. Goal

Give F2 a complete **portal user lifecycle** that can start from ticket creation:

- Admin registers a person by **email** with minimal info.
- System emails the user **login instructions** (username + temporary password) and asks them to change it.
- Email carries a **verify-email** link; user has an **email-verified / unverified** status.
- An account can be **active regardless of verification**; admin can toggle whether verification is **enforced** (flexible).
- A user **belongs to organization(s)** and can update their **full profile**.
- **No duplicate emails.**
- **Admin can resend** the link; **user can self-request** the link later if lost.

## 2. Locked decisions

| Decision | Choice | Consequence |
|---|---|---|
| Password setup | **Temp password + forced change** | System generates a temp password, emails it with login instructions, forces change on first login. Verify-email is a separate link. |
| Org membership | **Multiple orgs per user** | New membership join table; global-unique email becomes the join key (one person, many orgs); login gains an **active-org** selection. |
| Verification enforcement | **Allow login, limit actions** | Unverified users log in, see a banner, and are blocked from sensitive actions (create ticket / reply) when enforcement is ON. |

## 3. Concept reuse (what we build on)

| Need | Existing primitive | Verdict |
|---|---|---|
| The "user" | `customer_contacts` (email, password_hash, full_name, role, locale, `disabled_at`) — `009_customers.sql` | **REUSE** |
| No duplicate email | `customer_contacts.email CITEXT NOT NULL UNIQUE` (global) | **REUSE** — now doubles as the multi-org join key |
| Secure email link | `password_resets`: hashed single-use token, TTL, dual-identity XOR — `042_password_reset_and_smtp.sql` | **EXTEND** (add `purpose`) |
| Send email | notification-api pipeline + bilingual `notification_templates` (e.g. `password_reset_customer`) | **EXTEND** (2 templates) |
| Admin manages org's users | `/admin/customers/[id]` page + `POST …/customers/{id}/contacts` (`admin.go CreateContact`) | **EXTEND** |
| Login / reset pages | `/portal/login`, `/portal/login/reset/{token}` | **EXTEND** |
| Ticket ↔ requester | `tickets.customer_id` (req) + `opened_by_contact_id` (opt) | **REUSE** — no ticket schema change |
| On/off toggle | `modules` table + `/admin/features` | **EXTEND** (1 key) |
| Settings row | `smtp_settings` / `payment_settings` pattern (022, 042) | **REUSE** for the enforce flag |

## 4. Data model — migration `071_user_accounts.sql` (070 is current head)

```sql
-- customer_contacts: lifecycle + profile fields
ALTER TABLE customer_contacts
  ADD COLUMN IF NOT EXISTS email_verified_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS invited_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS activated_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS phone                TEXT,
  ADD COLUMN IF NOT EXISTS job_title            TEXT;
-- password_hash stays NOT NULL: a temp password is always set at create time.

-- One token primitive for reset / activation / verification (max reuse)
ALTER TABLE password_resets
  ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'reset'
  CHECK (purpose IN ('reset','activation','verification'));

-- Multi-org membership (the 1:1 customer_contacts.customer_id becomes the "primary" home org)
CREATE TABLE IF NOT EXISTS contact_org_memberships (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id   UUID NOT NULL REFERENCES customer_contacts(id) ON DELETE CASCADE,
  customer_id  UUID NOT NULL REFERENCES customers(id)         ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  is_primary   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (contact_id, customer_id)
);
-- Backfill: one membership row per existing contact, is_primary = TRUE.
INSERT INTO contact_org_memberships (contact_id, customer_id, role, is_primary)
SELECT id, customer_id, role, TRUE FROM customer_contacts
ON CONFLICT DO NOTHING;

-- Enforcement flag (settings row, mirrors smtp_settings pattern)
-- portal.require_email_verification: 'on' | 'off' (default 'off')

-- Module key seed (EN + TH): portal.user_accounts
```

**Notes**
- Keep `customer_contacts.customer_id` as the **primary/home org** for backward compatibility; additional orgs live in `contact_org_memberships`. Every existing per-org query keeps working; new queries that need "all my orgs" join the membership table.
- Email stays globally unique → the same email is one `customer_contacts` row that can hold many memberships. "Invite by email" under an org becomes **find-or-create person, then add a membership** (never a 409 on existing email — instead: link).

## 5. Login & token changes (multi-org)

- Customer JWT already embeds a single `customer_id` (tenant scope). With multiple orgs, add an **active-org** concept:
  - On login: if the user has 1 membership → token scoped to it (as today). If >1 → return the membership list; user picks an **active org**; token minted for that `customer_id`.
  - New `POST /api/auth/customer/switch-org {customer_id}` → re-mint access token for another membership the user belongs to (validated against `contact_org_memberships`).
- Portal shows an **org switcher** when membership count > 1. All existing `WHERE customer_id = $1` queries stay correct against the active-org claim.
- `must_change_password = TRUE` → after auth, portal forces the change-password screen before any other action.

## 6. Backend endpoints

**Admin (customer-api, staff-gated) — extend `admin.go`:**
- `POST …/customers/{id}/contacts` — **find-or-create person by email**, add membership to `{id}`, generate temp password, set `must_change_password`, `invited_at`; dispatch `contact_invite_customer` (login instructions) + `email_verification_customer`. Returns whether the person was newly created or linked.
- `POST …/contacts/{contactId}/resend` `{purpose:"activation"|"verification"}` — resend the relevant link/instructions.
- Existing disable/enable retained.

**Public / portal (auth-api, model on `password_reset.go`):**
- `POST /api/auth/customer/verify-email {token}` → stamp `email_verified_at`.
- `POST /api/auth/customer/request-link {email, purpose}` → **enumeration-safe** self-service resend, rate-limited.
- `POST /api/auth/customer/change-password {current,new}` → in-session change; clears `must_change_password`.
- `POST /api/auth/customer/switch-org {customer_id}` → active-org token (see §5).
- Existing `forgot-password` / `reset-password` reused for logged-out reset.

**Portal (customer-api):**
- `PATCH /api/portal/me {full_name, phone, job_title, locale}` → self profile edit (extends today's `/me/locale`).
- **Verification gate:** when `require_email_verification=on` and `email_verified_at IS NULL`, block sensitive handlers (`CreateTicket`, `AddMessage`) with a clear 403 + banner; login and read stay allowed.

## 7. Emails (bilingual EN + TH, clone `password_reset_customer`)

- `contact_invite_customer` — subject + body: username (email), **temporary password**, login URL, "please change your password", and the verify-email link. Vars: `{full_name, email, temp_password, login_url, verify_url, org_name}`.
- `email_verification_customer` — standalone verify link (used by resend/self-request). Vars: `{full_name, verify_url, ttl_minutes}`.

## 8. Admin UI (`/admin/customers/[id]` + ticket-new)

- Replace the plaintext-password add form with **"Invite user by email"** (email, full name, phone, role). On submit, show "created new user" vs "linked existing user to this org."
- Per-user **status badges**: Active/Disabled · Email verified/Unverified · Pending-change/Activated · Primary-org tag. **Resend** menu (invite / verification).
- **Ticket-new page:** optional **"register requester by email"** → provisions/links a contact under the chosen org, then creates the ticket with that `opened_by_contact_id` (no ticket schema change).
- **Enforcement toggle** surfaced on `/admin/features` (or a settings panel): `portal.require_email_verification`.

## 9. Portal UI

- `/portal/verify-email/{token}` — confirms verification.
- `/portal/profile` — edit full profile + change password.
- Login page: **"request a new link"** action (calls `request-link`).
- **Org switcher** in the portal header when membership > 1.
- First-login **forced change-password** screen when `must_change_password`.
- Persistent **"verify your email"** banner while unverified.

## 10. Cross-cutting

- Tokens: hashed, single-use, TTL — activation/instructions 72h, verification 24h, reset 60m; bcrypt cost 12; temp password = CSPRNG, ≥12 chars.
- Enumeration-safe endpoints (always 200); rate-limit `request-link`.
- Audit via existing `audit_log` (invite sent, resend, email verified, password changed, org linked).
- i18n: EN + TH parity in the same change (`make i18n-check`, CI gate).
- Module gating via `authmw.GateModule("portal.user_accounts")` on new route groups.

## 11. Reuse ledger

| Area | REUSE | EXTEND | NEW |
|---|---|---|---|
| Data | `customer_contacts`, unique email, `password_resets` token, settings pattern | `password_resets.purpose`, `customer_contacts` lifecycle cols | `contact_org_memberships`, enforce flag, module key |
| Auth | customer login/refresh/logout, forgot/reset | multi-org token mint | `verify-email`, `request-link`, `change-password`, `switch-org` |
| Email | notification-api pipeline | — | `contact_invite_customer`, `email_verification_customer` |
| Admin UI | customers/[id] surface, admin-api helpers | invite form + badges + resend | register-by-email in ticket-new |
| Portal UI | login/reset pages | `/me` profile edit | verify page, profile page, org switcher, request-link |

## 12. Rollout phases

1. **DB + token + email** — migration 071, `purpose` column, 2 templates, backfill memberships.
2. **Backend** — invite/resend, verify-email, request-link, change-password, switch-org, profile PATCH, verification gate.
3. **Admin UI** — invite form, status badges, resend, ticket-new register-by-email, enforce toggle.
4. **Portal UI** — verify page, profile, forced change-password, org switcher, request-link, banner.
5. **QA + i18n + audit + module toggle**, then memory write-back.

## 13. Open follow-ups / risks

- **Latent JWT bug** (`services/customer-api/internal/middleware/jwt.go:50-55`): `sub` stored as both `CtxUserID` and `CtxContactID`; harmless for staff, but on portal uploads it could set `uploaded_by_user_id` to a contact id. Fix alongside this work.
- **Membership migration numbering:** untracked `054/055` (contract feature) collide with committed numbers up to 070 — coordinate so 071 is truly free.
- **Owner vs member roles across orgs:** role now lives on the membership, not the person — confirm the portal permission model treats role per active org.
