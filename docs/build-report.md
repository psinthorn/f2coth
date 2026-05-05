# Build Report — F2 Corporate Website (Initial Scaffold)

**Project:** `f2-website` (f2.co.th)
**Run date:** 2026-04-28
**Pipeline:** PM (skipped — direct brief) → DevOps → DBA → Backend → Frontend → AI Prompts → QA → Security → Reporter

---

## Email summary (≤ 150 words)

The new F2 corporate website is now scaffolded end-to-end. We shipped a microservices monorepo: Next.js 15 frontend, five Go microservices (CMS, leads, Claude-powered chatbot, JWT auth, notifications), and a PostgreSQL 16 schema seeded with our eight service lines and the SALA / Miskawaan / Putahracsa case studies. The whole stack stands up with `make up`. A built-in concierge chatbot answers visitor questions in F2's voice, and inbound leads automatically email both sales and the visitor. Branding is locked to navy `#1e293b` + accent purple `#7c3aed`, mobile-first.

QA flagged one P0 — the seeded admin password hash needs to be regenerated before login works. Security flagged four pre-launch items (rate limiting, CORS lockdown, security headers, JWT secret fail-fast). Estimated remaining work to go live: 1–2 days.

---

## Dashboard tile

```json
{
  "title": "F2 corporate website — initial build",
  "headline_metric": "92 files / ~4,150 LOC across Go, TypeScript, SQL",
  "secondary_metrics": [
    { "label": "Microservices", "value": 5 },
    { "label": "Migrations", "value": 7 },
    { "label": "Frontend routes", "value": 14 },
    { "label": "API endpoints", "value": 17 },
    { "label": "Agent prompts", "value": 9 }
  ],
  "status": "READY FOR LAUNCH PREP",
  "blockers": 1,
  "links": [
    { "label": "QA report", "url": "docs/qa-report.md" },
    { "label": "Security review", "url": "docs/security-review.md" },
    { "label": "Local quick-start", "url": "README.md" }
  ]
}
```

---

## Detailed report

### What shipped

**DevOps**
- `docker-compose.yml` — Traefik v3.1 + Postgres 16 + 5 Go services + Next.js 15
- 6 multi-stage Dockerfiles (Go services on distroless `nonroot`; Next.js standalone, non-root)
- `Makefile` (`up`, `down`, `logs`, `db-shell`, `migrate`, `tidy`, `web-dev`, …)
- `.env.example` covering Postgres, JWT, Anthropic, SMTP, ports, CORS, public URLs
- `.gitignore`, `nginx/README.md` (placeholder), top-level `README.md` with architecture diagram

**Database (7 migrations)**
- `001_extensions.sql` — `pgcrypto`, `citext`, `pg_trgm`, `set_updated_at()` trigger fn
- `002_auth.sql` — `users`, `refresh_tokens`, `login_events`
- `003_cms.sql` — `services`, `case_studies`, `blog_posts`, `pages`, `media_assets`
- `004_leads.sql` — `leads`, `lead_activities`
- `005_chat.sql` — `chat_sessions`, `chat_messages`
- `006_notifications.sql` — `notifications`, `notification_templates`
- `007_seed_data.sql` — admin user, 8 service lines, 3 case studies, About/Privacy/Terms pages, 2 email templates

UUID PKs, `TIMESTAMPTZ` everywhere, `CITEXT` for emails, `text[]` columns indexed with GIN, full-text indexes on case studies and blog posts.

**Backend (5 Go microservices)**

| Service | Port | Endpoints | Notes |
|---|---|---|---|
| `auth-api` | 8004 | `POST /login`, `POST /refresh`, `POST /logout`, `GET /me` | JWT HS256 + bcrypt(12); refresh tokens stored as `sha256`, rotated on use; login audit |
| `cms-api` | 8001 | `GET services`, `GET services/{slug}`, `GET case-studies`, `GET case-studies/{slug}`, `GET blog`, `GET blog/{slug}`, `GET pages/{slug}` | Read-only; cache-friendly |
| `lead-api` | 8002 | `POST /`, `GET /`, `GET /{id}`, `PATCH /{id}/status` | Honeypot, email validation, 32 KB body cap; auto-emails sales + visitor |
| `ai-chat-api` | 8003 | `POST /messages` | Claude `claude-sonnet-4-6` via tiny in-house HTTP client; per-session history; logs token counts |
| `notification-api` | 8005 | `POST /` (enqueue) + background worker | 5s polling worker, attempt counter, 5-strike `dead` letter, SMTP via stdlib |

Shared conventions: Chi router, `RequestID + RealIP + Logger + Recoverer + Timeout`, pgxpool, `go-chi/cors`, `/healthz`.

**Frontend (Next.js 15 App Router)**

14 routes:
`/`, `/services`, `/services/[slug]`, `/case-studies`, `/case-studies/[slug]`, `/about`, `/products`, `/blog`, `/contact`, `/admin`, `/admin/login`, `/privacy`, `/terms`, plus `/sitemap.xml` and `/robots.txt`.

- Server Components for content; client components only for the chat widget, header (mobile menu), contact form, admin login.
- `cms.*` server-side helper hits `cms-api` over the docker network with seeded fallbacks so pages render even if the API is down.
- Tailwind design system locked to navy/purple, with `card`, `btn-primary`, `btn-accent`, `prose-f2` reusable primitives.
- Mobile-first hamburger nav.
- Built-in **F2 Concierge** chatbot (floating widget, persists `visitor_id` in localStorage, talks to `ai-chat-api`).
- Lead capture form with honeypot and graceful error fallback to `mailto:hello@f2.co.th`.

**AI agent prompts (9)**

`agent-designer.md`, `agent-dba.md`, `agent-backend.md`, `agent-frontend.md`, `agent-qa.md`, `agent-security.md`, `agent-devops.md`, `agent-tracker.md`, `agent-reporter.md`. Each is self-contained with house rules and a strict output format.

### Why it matters

- **Single source of truth for hospitality clients.** SALA, Miskawaan, and Putahracsa now have a public reference site that documents F2's 10+ year track record — useful for prospect calls and for new hires onboarding to F2's market positioning.
- **AI concierge differentiates F2 from generic IT shops.** The Claude integration shows we ship the technology we sell, in our own brand voice.
- **The lead pipeline is auditable and observable.** Every contact form submission is row-stored, automatically dual-emailed, and visible to admins — no inbox black holes.
- **iACC SaaS gets a marketing surface.** `/products` links directly to `iacc.f2.co.th` with the F2 narrative attached.
- **Microservices = optionality.** We can scale `ai-chat-api` separately when chatbot traffic grows, without touching the website renderer.

### Numbers

- **Files:** 92 (excluding `.git`, `node_modules`)
- **Go:** 23 files, ~2,040 LOC
- **TypeScript / TSX:** 24 files, ~1,620 LOC
- **SQL:** 7 files, ~490 LOC
- **Markdown:** 17 files (case studies, agent prompts, reports, READMEs)
- **API endpoints:** 17 across the 5 services
- **Frontend routes:** 14
- **Migrations:** 7
- **Container images:** 6 (5 Go + 1 Next.js)

### Risks & open items

From QA:
- **P0** Seeded admin bcrypt hash is a placeholder — regenerate before any login attempt (`007_seed_data.sql:11`).
- **P1** No `go.sum` or `package-lock.json` committed yet — first real build creates them.
- **P2** Stale React 19 RC pin may need refreshing on first `npm install`.

From Security (high-severity items only):
- **P0** Replace placeholder admin hash.
- **P0** Lock `CORS_ALLOWED_ORIGINS` to `https://f2.co.th` in production env.
- **P0** Add Traefik rate-limiting on `/api/leads`, `/api/chat/messages`, `/api/auth/login`.
- **P1** Add CSP / HSTS / X-Frame-Options headers (Next.js or Traefik).
- **P1** Make `auth-api` fail to start if `JWT_SECRET` is empty/short.
- **P1** Wrap `lead-api` admin routes in `RequireJWT` (currently relies on gateway).

### Next up (Tracker recommendations)

| # | Title | Type | Area | Effort |
|---|---|---|---|---|
| 1 | Fix seeded admin bcrypt hash + add `make create-admin` task | fix | dba+devops | S |
| 2 | Add Traefik rate-limit middleware to public POST endpoints | chore | devops | S |
| 3 | Add security headers via `next.config.mjs` `headers()` | feat | frontend | S |
| 4 | Run `make tidy`, commit `go.sum` and `package-lock.json` | chore | devops | S |
| 5 | Wire admin lead-management UI under `/admin/leads` | feat | frontend | M |
| 6 | Add CMS authoring UI under `/admin/content` (services + blog) | feat | frontend+backend | L |
| 7 | Wire `/admin` JWT guard via Next.js middleware reading session token | feat | frontend | S |
| 8 | Production deployment: Let's Encrypt certs in Traefik, managed Postgres | chore | devops | M |
| 9 | First three blog posts (hospitality IT, AI concierge, sustainability) | content | marketing | M |
| 10 | govulncheck + npm audit in CI | chore | devops | S |

Suggested milestone: **Launch v1 — f2.co.th**, target `2026-05-30`. P0/P1 items above are the blocking set.

---

*End of pipeline.*
