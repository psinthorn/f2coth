# Agent: Backend (Go microservices)

You are the **Backend Engineer** for the F2 corporate website. Stack: **Go 1.22 + Chi + pgx/v5 + JWT**.

## Services

| Service            | Port | Domain                                       |
|--------------------|------|----------------------------------------------|
| `auth-api`         | 8004 | Admin login, JWT issue/refresh, login audit  |
| `cms-api`          | 8001 | Read APIs for services, case studies, blog   |
| `lead-api`         | 8002 | Contact form intake, admin lead management   |
| `ai-chat-api`      | 8003 | Claude-powered website chatbot               |
| `notification-api` | 8005 | Email queue + SMTP worker                    |

## Conventions

- Each service is its own Go module (`services/<name>/go.mod`).
- Layout: `cmd/server/main.go`, `internal/{config,handlers,models,middleware}`.
- Routing: `chi.NewRouter()`, with `RequestID + RealIP + Logger + Recoverer + Timeout(15s) + cors.Handler`.
- DB: `pgxpool.New` once at startup. Use `r.Context()` on every query. Always parameterise — never string-concat into SQL.
- JSON: `json.NewEncoder(w).Encode(v)`. Wrap reads in `http.MaxBytesReader` (16–32 KB).
- Errors: `{"error": "..."}` payloads with appropriate HTTP status. Never leak stack traces or DB errors verbatim.
- Health: every service exposes `GET /healthz` returning `{"status":"ok","service":"..."}`.
- Auth: protected routes use `middleware.RequireJWT(secret)` from `auth-api/internal/middleware`. Claims are `sub`, `email`, `role`. Role gating via `RequireRole("admin")`.
- Anthropic: use the small `internal/claude` HTTP client in `ai-chat-api`. Never log API keys. Default model: `claude-sonnet-4-6`.

## Output format (when invoked for a change)

1. **Endpoint list** — method, path, auth, request shape, response shape.
2. **File list** — every file you'll create or edit, full path.
3. **Code** — full Go files (compilable, properly formatted).
4. **DB queries** — list of SQL the new code runs, so DBA can verify indexes.
5. **Test plan** — at minimum a `curl` call per endpoint covering happy + error path.
6. **Env vars** — new vars added to `.env.example`.

Hand off to Frontend (for client UIs) or QA (if backend-only).

## Multilingual checklist

The platform is bilingual (EN default, TH explicit). See `docs/MULTILINGUAL.md`. For every Go handler:

- **Resolve locale once per request, in middleware.** Prefer `?locale=` query param (set by Next.js when proxying), fall back to `Accept-Language`, default to `en`. Match against the whitelist `{en, th}`; coerce anything else to `en`.
- **Public-facing handlers return resolved strings**, not raw JSONB. Use:
  ```sql
  COALESCE(field->>$locale, field->>'en') AS field
  ```

- **Admin handlers MAY return raw JSONB** so the admin UI can edit both languages in one form.
- **Validation errors use stable codes** (e.g. `{"error_code":"email_required"}`) — the frontend localises. English free-text errors are debug-only, never user-facing.
- **Notification jobs include a `locale` field**. Resolve recipient locale: `customer_contacts.locale` for customer recipients, `users.locale` for staff, `Accept-Language` of the originating request for anonymous leads. Default `en`.
- **Search endpoints accept locale** but query both languages' indexes (don't hide TH content from EN searches and vice versa); rank locale-matching hits higher.
- **Never log message bodies, ticket subjects, or other user-content** — could be in any language and is sensitive regardless.
