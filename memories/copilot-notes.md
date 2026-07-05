# Copilot notes — pitfalls, quick-start, common mistakes

Practical guardrails collected from real sessions. Read before writing.

---

## Quick-start ritual (do these first, every new task)

1. `docker exec f2-postgres psql -U f2 -d f2_website -c "SELECT area, key, name_en FROM modules ORDER BY area, sort_order;"` — the live feature registry. If your feature is already there, it's already built (or half-built — check the code).
2. `ls database/migrations/ | tail -5` — never renumber; grab the next N.
3. `grep -r "the-thing-you're-about-to-write" services/` — prior-art check. Reuse or extend before creating.
4. Read `memories/repo/project.md` + `entities.md` — they are current as of the "Last verified" date in each file.
5. Only then: plan → write → tests → migrate → rebuild.

---

## Common mistakes

### Assuming migrations auto-apply after `git pull`

They don't. `make up` starts containers with the current image; it doesn't re-run SQL. If you added a migration you **must** run `make migrate` (or `docker exec -i f2-postgres psql -U f2 -d f2_website < database/migrations/NNN_*.sql`). Symptoms of forgetting: a nav item won't appear (its `modules` row isn't seeded); a portal query 500s (missing column).

### Rebuilding web-app locally then `docker compose up` — image is stale

The `web-app` container is a production Next.js build (`NODE_ENV=production`), not a bind-mount. Source edits do nothing until you `docker compose build web-app && docker compose up -d --no-deps web-app`. `--no-deps` is important; without it Compose tries to recreate cms-api and friends, hits name collisions, and leaves half-created containers around.

### `npm ci` fails inside the Docker build after a local `npm install`

Node 20 alpine (the Dockerfile base) resolves peer deps slightly differently from your local Node 22. Regenerate the lockfile inside the same image before rebuilding:

```bash
docker run --rm -v $PWD:/app -w /app node:20-alpine sh -c "npm install --no-audit --no-fund --package-lock-only"
```

Then `docker compose build web-app` succeeds.

### Adding a service on a taken port

Ports 8001–8010 are allocated (see `project.md`). Payment-api sits on **8010** because customer-api took 8006 first. Don't reuse. Next free: 8011+.

### Naive JWT role check leaks portal endpoints to admins

Customer tokens have `aud="customer"` + `customer_id` claim. Staff tokens have `role ∈ {admin, editor, viewer}` and no `aud`. A `role != ""` check accepts both. Use `RequireCustomer` (`aud=="customer"` gate) for portal routes and always scope the query by `customer_id`.

### Forgetting the module toggle

Every new UI feature must insert into `modules` (same migration is fine). AdminShell + PortalShell filter their nav by `isEnabledIn(modules, moduleKey)`. If you skip this, your feature exists at `/admin/foo` but no nav item shows and users think it's broken.

### i18n parity break

CI fails if EN and TH key counts diverge. When adding keys, use a script or add to both files in one commit. Verify with `npm run i18n-check` — it prints the exact diff.

### JOINing project_items back to checklist_template_items

Don't. Items are **snapshotted** at attach time so template edits (or deletes) don't rewrite in-flight audits. Query `project_items` directly.

### `customer_contacts.is_active` doesn't exist

The convention on this table is `disabled_at TIMESTAMPTZ` — an active contact has `disabled_at IS NULL`. `is_active` exists on `users` and on some other tables but **not** here. Assuming the pattern-match will bite you at runtime with a "column does not exist" 500 that only shows up on the write path. Verified against the schema in 009.

### Distroless containers + Docker named volumes ownership

The Go services use `gcr.io/distroless/static-debian12:nonroot` (UID 65532). If you add a named volume mount for writable data (uploads, cache), the volume is created **root-owned** by the Docker daemon on first mount, so the nonroot process gets EACCES on `O_CREATE`. Fix in the Dockerfile before shipping:

```dockerfile
# in the build stage:
RUN mkdir -p /uploads
# in the runtime stage:
COPY --from=build --chown=65532:65532 /uploads /data/uploads
```

After changing the Dockerfile, the running install also needs `docker volume rm <project>_<volume>` before `up -d` — Docker only copies image contents into a volume on first mount, not on rebuild.

### notification-api endpoint is `POST /api/notifications/` (trailing slash)

Inside checklist-api I wrote `POST /api/notifications/enqueue` from muscle memory — that returned 404 without any body clue. The actual chi route in notification-api's `cmd/server/main.go` is `Route("/api/notifications", …) + Post("/", h.Enqueue)`. Match exactly, trailing slash included.

### Distroless has no shell — you can't `docker exec sh` to debug

`docker exec f2-checklist-api sh` returns "exec: sh: executable file not found in $PATH". If you need to see what's inside, either add a temporary debug stage that uses `alpine` and shell in, or query the DB / logs / volumes from the host side (`docker volume inspect <name>`).

### Playwright browsers not installed

The `@playwright/test` npm package is installed but the browser binaries aren't. First run: `npx playwright install chromium`.

---

## Reuse-first cheatsheet

| Need                           | Reach for                                                          |
|--------------------------------|--------------------------------------------------------------------|
| Staff auth middleware          | `services/checklist-api/internal/middleware/auth.go` (3 gates)     |
| Customer auth middleware       | Same file, `RequireCustomer`                                       |
| Frontend auth wrapper (staff)  | `services/web-app/src/lib/admin-api.ts` (`request<T>`, refresh)    |
| Frontend auth wrapper (portal) | `services/web-app/src/lib/portal-api.ts`                           |
| Admin nav                      | `services/web-app/src/components/AdminShell.tsx` (add to NAV)      |
| Portal nav                     | `services/web-app/src/components/PortalShell.tsx`                  |
| Module registry                | `modules` table + `INSERT ... ON CONFLICT DO NOTHING`              |
| Bilingual JSONB pattern        | See `services` / `blog_posts` / `case_studies` in migrations 003   |
| `updated_at` trigger           | `set_updated_at()` (defined in 001_extensions.sql)                 |
| Audit log                      | `audit_log` (generic actor/resource/action) — 019                  |
| Card CSS class                 | `.card` utility in `globals.css` (rounded-xl white card)           |
| Live E2E probe (checklist-api) | `bash services/checklist-api/e2e/checklist_e2e.sh` (50 checks)     |

---

## When in doubt, ask the DB

The database is the source of truth for what exists. Files can lie (unmerged branches, half-refactors); Postgres can't. Get in the habit of:

```bash
docker exec f2-postgres psql -U f2 -d f2_website
\d+ table_name           -- schema + indexes
\dt                      -- all tables
SELECT * FROM modules WHERE key LIKE 'admin.%';
```

before assuming a table, column, or module row exists.
