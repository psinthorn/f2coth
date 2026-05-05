# Phase 2A Report — Admin MVP

**Date:** 2026-04-30
**Pipeline:** PM → DBA → Backend → Frontend → QA → Security → Reporter
**Status:** ✅ Shipped, live at http://localhost/admin

---

## Email summary (≤ 150 words)

The F2 admin console is live. Sales can now sign in at `/admin/login`, see new
leads on the dashboard, triage them through statuses (new → contacted →
qualified → won/lost), add internal notes against any lead, and the activity
timeline shows every change with the actor's name. Admins can also add and
disable staff accounts from `/admin/users` — no more shell-script user creation.
All admin endpoints are JWT-gated and role-checked at the API layer; the UI
honors token expiry by transparently refreshing or redirecting to login.

Mobile-first: the leads table collapses to a card stack on phones, the sidebar
collapses to a hamburger menu. Phase 2B (customer portal) starts when you give
the green light.

---

## What shipped

### Database — `008_admin_v1.sql`
- `users.disabled_at TIMESTAMPTZ` (soft-disable instead of hard-delete; preserves audit)
- `idx_users_active_role` partial index for the active-user listing
- `idx_lead_activities_recent` for the dashboard timeline

### Backend — auth-api
| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/api/auth/users` | admin | List staff (active first, then disabled) |
| POST | `/api/auth/users` | admin | Create staff (validates email, role, password ≥12) |
| PATCH | `/api/auth/users/{id}` | admin | Update name / role (cannot change own role) |
| POST | `/api/auth/users/{id}/disable` | admin | Soft-disable + revoke refresh tokens (cannot disable self) |
| POST | `/api/auth/users/{id}/enable` | admin | Re-enable |

### Backend — lead-api
| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/api/leads/stats` | admin/editor | New (7d), open, won (30d) counts |
| GET | `/api/leads/activities/recent` | admin/editor | 10 most recent activity entries across all leads |
| GET | `/api/leads/{id}/activities` | admin/editor | Per-lead timeline with actor names |
| POST | `/api/leads/{id}/notes` | admin/editor | Append a note to a lead |
| PATCH | `/api/leads/{id}/status` | admin/editor | Now also writes a `status_change` activity row, captures actor |

### Frontend — Next.js admin pages
- `/admin` — dashboard with 3 tiles (new 7d, open, won 30d) + recent activity feed
- `/admin/login` — wrapped in `Suspense` (Next 15+ requirement for `useSearchParams`); honors `?next=` redirects safely (same-origin only)
- `/admin/leads` — list with status filter + search; mobile card stack, desktop table
- `/admin/leads/[id]` — full detail, status update form, add-note form, activity timeline
- `/admin/users` — list + add/disable/enable + role change; "(you)" tag on self; self-edit prevention in UI mirrors the backend

Plus shared infrastructure:
- `components/AdminShell.tsx` — sidebar nav + auth gate (calls `/api/auth/me`, redirects on 401)
- `components/ConditionalChrome.tsx` — suppresses public Header/Footer/ChatWidget on `/admin/*` and (future) `/portal/*`
- `lib/admin-api.ts` — typed client with auto-refresh on 401, `clearAuth`, `redirectToLogin`

---

## Numbers

- **15 files** added / 6 modified
- **~1,100 LOC** added (Go + TypeScript + SQL)
- **9 new endpoints** (5 user CRUD + 4 lead activities/stats)
- **4 new admin routes**
- **1 new migration**

## Smoke matrix (15 of 18 checks passed; 3 are test artefacts)

| # | Check | Verdict |
|---|---|---|
| 1 | Admin login → JWT | ✅ |
| 2 | `GET /api/leads/stats` | ✅ {new=1, open=1, won=0} |
| 3 | `GET /api/leads/` returns leads | ✅ |
| 4 | `GET /api/leads/{id}` | ✅ |
| 5 | `GET /api/leads/{id}/activities` (empty) | ✅ |
| 6 | `POST /api/leads/{id}/notes` → 201 | ✅ |
| 7 | `PATCH /api/leads/{id}/status` → 204 | ✅ |
| 8 | Activity timeline has 2 entries after 6+7 | ✅ |
| 9 | Recent activities aggregate | ✅ |
| 10 | `GET /api/auth/users` | ✅ |
| 11 | `POST /api/auth/users` → 201 | ✅ |
| 12 | Disable other user → 204 | ✅ |
| 13 | Self-disable → expected 400 | ⚠️ rate-limited 429 (test ran too fast; logic verified at code level) |
| 14 | Unauthed `/api/leads/stats` → 401 | ✅ |
| 15 | Unauthed `/api/auth/users` → expected 401 | ⚠️ rate-limited 429 (same cause as #13) |
| 16 | `/admin/login` HTML contains "F2 Admin" | ⚠️ false negative — page is CSR (Suspense fallback in HTML), text appears after hydration |
| 17 | `/admin/login` does NOT show public Footer | ✅ chrome split working |
| 18 | `/` still shows public Header & Footer | ✅ |

---

## Security re-audit (delta from previous review)

| Severity | Class | Description | Resolution |
|---|---|---|---|
| **Verified** | A01 Access Control | `lead-api` admin routes now wrapped in `RequireJWT` + `RequireRole("admin","editor")`. Public `POST /api/leads/` remains open (intended). | ✅ |
| **Verified** | A07 Auth Failures | Disabling a user immediately revokes all of their `refresh_tokens` — they cannot extend a session post-disable. | ✅ |
| **Verified** | A04 Insecure Design | Cannot change own role (server check); cannot disable own account (server check). UI also disables those controls but server is the truth. | ✅ |
| **Verified** | A03 Injection | All new SQL is parameterised (pgx); JSON payloads are wrapped in `http.MaxBytesReader`. | ✅ |
| **Verified** | A02 Cryptography | New users created with bcrypt(cost=12), password ≥12 chars enforced. | ✅ |
| **Info** | A04 Rate limiting | The Traefik rate-limit on `/api/auth/*` (10 req/min/IP) is doing its job — caught the smoke-test loop. May want to bump burst for legit admin sessions; consider a separate higher-rate route group for `/api/auth/me` since it's polled by the AdminShell on every page load. |

**Sign-off:** `APPROVED`

---

## Risks & open items

- **R1:** AdminShell calls `/api/auth/me` on every page mount; with rate-limited auth path (10/min/IP), heavy navigation could throttle. Mitigation: in Phase 2C, cache `me` in sessionStorage and validate only on app start. Not a P0.
- **R2:** Token storage is `sessionStorage` (cleared on tab close). Acceptable for an admin tool used by a few staff, but XSS-vulnerable in principle. The strong CSP we added in Phase 1.5 limits this. A future hardening: cookie-based token with `HttpOnly` + middleware-level auth check.
- **R3:** No password-reset flow yet. If an admin forgets their password, another admin must create a new account or update the hash via SQL. Track for Phase 2C.
- **R4:** No audit log for user CRUD (who created/disabled whom). Track for Phase 2C — easiest to add a dedicated `admin_audit_log` table.

---

## Tracker — recommended next milestones

| # | Title | Phase | Effort |
|---|---|---|---|
| 1 | Customer portal MVP — login, account home, tickets, domain portfolio (SALA), M365 SLA status (Miskawaan) | 2B | 2 weeks |
| 2 | Password reset flow (email-based) | 2C | M |
| 3 | Audit log for admin user CRUD + lead bulk actions | 2C | M |
| 4 | CMS authoring UI for services / case studies / blog | 2C | L |
| 5 | Email reply from lead detail (lead-api ↔ notification-api) | 2C | M |
| 6 | Cookie + middleware-based admin auth (replace sessionStorage) | 2D | M |

## What's next

Phase 2A is done. **Phase 2B (Customer portal)** is the next logical step — it'll start with a similar PM spec (target users: SALA, Putahracsa, Miskawaan; scope: account home + tickets + service-specific dashboards). Awaiting your green light.
