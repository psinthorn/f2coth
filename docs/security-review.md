# Security Review — F2 Corporate Website Scaffold

**Date:** 2026-04-28
**Scope:** Initial multi-agent build of `f2-website`. Static review of all `.go`, `.tsx`, `.ts`, `.sql`, `Dockerfile`, `docker-compose.yml`, `.env.example`.

## Findings

| Severity | Class | Description | File:line | Recommended fix | OWASP |
|---|---|---|---|---|---|
| **High** | A07: Identification & Auth Failures | Seed admin password hash in `007_seed_data.sql` was hand-written, not bcrypt-generated. Either no admin can log in, or worse, the placeholder hash matches some other string. | `database/migrations/007_seed_data.sql:11` | Replace with a real `bcrypt(cost=12, "F2@admin2026")` hash, or remove the seeded admin and require a one-shot `make create-admin` step. | A07 |
| **High** | A05: Security Misconfiguration | `CORS_ALLOWED_ORIGINS=*` is the development default and is wired into all 5 services. If shipped to prod un-edited, every site can call our APIs. | `.env.example:35`, all `internal/config/config.go` | In `prod.env` (separate file), pin to `https://f2.co.th` only. Add a startup log warning when `CORS_ALLOWED_ORIGINS=*`. | A05 |
| **High** | A04: Insecure Design / abuse | No rate limiting on `POST /api/leads/`, `POST /api/chat/messages`, or `POST /api/auth/login`. A bot or attacker can spam leads, exhaust Anthropic budget, or brute-force admin login. | All public endpoints | Add Traefik rate-limit middleware (e.g. 30 req/min/IP for leads, 10 for chat, 5 for login). Document in `docker-compose.yml`. | A04 |
| **Medium** | A02: Cryptographic Failures | `JWT_SECRET` default in `config.Load()` is `"dev-secret-change-me"`. If env is ever unset in prod, every issued token is forgeable. | `services/auth-api/internal/config/config.go:23` | Refuse to start if `JWT_SECRET` is empty or shorter than 32 chars. | A02 |
| **Medium** | A05: Security Misconfiguration | No CSP, HSTS, X-Frame-Options, or Referrer-Policy headers configured (Next.js or Traefik). | `services/web-app/next.config.mjs`, `docker-compose.yml` | Add `headers()` to `next.config.mjs` with sensible defaults. Add Traefik HSTS middleware. | A05 |
| **Medium** | A09: Security Logging Failures | `log.Printf("notification %s failed: %v", ...)` could include rendered email body fragments via the wrapped error. | `services/notification-api/internal/handlers/notifications.go:128` | Confirmed clean — the wrapped error is from `smtp.SendMail` which won't include body. No change needed, but worth re-checking after any future template change. Downgraded to **Info**. | A09 |
| **Medium** | A03: Injection (SSRF-adjacent) | `lead-api` makes a server-to-server POST to `NOTIFICATION_API_URL` based on env. If the env var is overridden (e.g. via a leaked admin endpoint that re-loads config), an attacker could redirect notifications. | `services/lead-api/internal/config/config.go` | Acceptable today (config is process-startup only). Note: never expose a "reload config" endpoint without admin auth. | A03 |
| **Low** | A05: Security Misconfiguration | Traefik dashboard is enabled with `--api.insecure=true` and exposed on `:8080` in dev. | `docker-compose.yml:14-16` | Acceptable for local dev. Block port 8080 in production compose / firewall, or front it with auth. | A05 |
| **Low** | A06: Vulnerable Components | `go.mod` files have minor versions pinned (`v5.1.0`, `v5.6.0` etc.) — fine — but no `go.sum` is committed yet. After first build, commit `go.sum` to lock transitive deps. | all `services/*/go.mod` | Run `make tidy` once and commit. | A06 |
| **Low** | A01: Broken Access Control | `lead-api` exposes `GET /api/leads/`, `GET /api/leads/{id}`, `PATCH /api/leads/{id}/status` without JWT verification at the service level. The intent is to protect them at Traefik or via a future gateway middleware. | `services/lead-api/cmd/server/main.go:48-51` | Until the gateway middleware exists, wrap admin routes with the same `RequireJWT(secret)` middleware shared by `auth-api` (or copy the middleware into `lead-api/internal/middleware`). | A01 |
| **Low** | A03: Injection — log forging | User-controlled `r.UserAgent()` and `r.Referer()` flow into INSERTs (parameterised, so no SQLi) but also into `log.Printf` paths via Chi's logger middleware. | various | Chi's logger uses structured fields, not raw concat — accepted as low risk. | A03 |
| **Info** | A04: Secure design | Honeypot field (`website`) on `lead-api` and silent-accept behaviour on bot submissions is a good defensive pattern. | `services/lead-api/internal/handlers/leads.go:55` | Keep. | — |
| **Info** | A02: Cryptographic Failures | Refresh tokens are stored as `sha256(token)` and rotated on every use. Old tokens are revoked, not deleted, providing forensic trail. | `services/auth-api/internal/handlers/auth.go` | Good. Consider a janitor goroutine to purge tokens with `expires_at < NOW() - INTERVAL '30 days'`. | — |
| **Info** | A05: Security Misconfiguration | Containers run as `nonroot` (Go services on distroless, web-app as `nextjs` user). | all `Dockerfile`s | Good. | — |
| **Info** | A02: Cryptographic Failures | `BCRYPT_COST=12` default is current best practice. | `.env.example`, `auth-api/config` | Good. | — |

## Hardening checklist (pre-production)

- [x] **P0** Replace the seeded admin password hash with a real bcrypt output. *(verified hash in `007_seed_data.sql`)*
- [x] **P0** Fail-fast on missing/short `JWT_SECRET` in `auth-api` (and now `lead-api`).
- [x] **P0** Lock `CORS_ALLOWED_ORIGINS` to `https://f2.co.th` (services now refuse to start with empty list; warn on `*`).
- [x] **P0** Add Traefik rate-limit middleware for `/api/leads`, `/api/chat`, `/api/auth/login`. *(30 / 10 / 10 req/min/IP respectively)*
- [x] **P1** Add CSP, HSTS, X-Frame-Options, Referrer-Policy via Next.js. *(in `next.config.mjs` `headers()`)*
- [x] **P1** Wrap `lead-api` admin routes (`GET /`, `GET /{id}`, `PATCH /{id}/status`) with `RequireJWT` + `RequireRole("admin","editor")`.
- [x] **P1** Run `make tidy` and commit `go.sum` (×5) and `package-lock.json`.
- [ ] **P1** Disable Traefik dashboard in production compose.
- [ ] **P2** Switch CSP from `'unsafe-inline'` to nonce-based via Next.js middleware.
- [ ] **P2** Add a refresh-token janitor that purges expired/revoked rows after 30 days.
- [ ] **P2** Periodic `npm audit` / `govulncheck` in CI.

## Sign-off

**STATUS:** `APPROVED WITH NOTES`

The architecture is sound: parameterised SQL throughout, bcrypt for passwords, JWT with HS256 + sensible TTLs, refresh-token rotation with hash-at-rest, body size caps, honeypot, distroless/non-root containers, no secrets in code. The High-severity items are all configuration/operational issues addressable before the production cutover — none require structural code changes.

Hand off to Reporter.
