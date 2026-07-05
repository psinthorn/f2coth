# checklist-api

F2 staff-facing service for running client IT projects: reusable checklist
templates, project boards with drag-drop module ordering, per-item status
tracking, and weekly/monthly reporting.

**Port:** `8008` &nbsp;·&nbsp; **Traefik prefix:** `/api/checklists`
&nbsp;·&nbsp; **First client:** Miskawaan (IT audit + weekly maintenance)

## Routes

All routes require a JWT from `auth-api`. Roles: `admin` manages templates
and projects; `editor` (tech) updates item status + adds visit logs;
`viewer` gets GET-only access.

| Method | Path | Role |
|---|---|---|
| GET    | `/templates` / `/templates/{id}`                             | any staff |
| POST   | `/admin/templates`                                            | admin |
| PATCH  | `/admin/templates/{id}`                                       | admin |
| DELETE | `/admin/templates/{id}`                                       | admin |
| POST   | `/admin/templates/import`                                     | admin |
| GET    | `/projects` / `/projects/{id}` / `/projects/{id}/board`       | any staff |
| GET    | `/projects/{id}/progress`                                     | any staff |
| GET    | `/projects/{id}/report?range=weekly\|monthly&date=YYYY-MM-DD` | any staff |
| GET    | `/projects/{id}/visits`                                       | any staff |
| POST   | `/admin/projects`                                             | admin |
| PATCH  | `/admin/projects/{id}` / DELETE                               | admin |
| POST   | `/projects/{id}/modules`                                      | admin |
| DELETE | `/projects/{id}/modules/{pmId}`                               | admin |
| PATCH  | `/projects/{id}/modules/reorder`                              | admin |
| PATCH  | `/items/{id}`                                                 | admin, editor |
| POST   | `/projects/{id}/visits`                                       | admin, editor |

## Data model

See [`database/migrations/038_projects_checklists.sql`](../../database/migrations/038_projects_checklists.sql)
and [`039_checklist_seed.sql`](../../database/migrations/039_checklist_seed.sql).

Attaching a template to a project **snapshots** its items into
`project_items` so later template edits never rewrite in-progress audits.

## iACC integration (planned)

iACC (github.com/psinthorn/iacc-php-mvc, prod at `iacc.f2.co.th`) is our
PHP 8.2/MySQL accounting system. It exposes a REST API (`api.php/*`) with
API-key auth, rate limiting, idempotency keys, and webhooks.

The tables already carry hooks for this:

- `projects.iacc_company_id` — nullable link to the iACC company record.
- `visit_logs.billable`, `.amount` — completed billable work waiting for
  a monthly close.

Planned monthly flow (not yet wired):

1. Cron / admin action calls `GET /projects/{id}/report?range=monthly`.
2. `internal/iacc` builds an `InvoiceDraft` from the billable visits + any
   agreed monthly retainer.
3. `Client.CreateInvoiceDraft` POSTs to iACC with an idempotency key so
   retries can't double-bill.
4. iACC returns the invoice ID; we store it on the project for reconciliation.

Today `internal/iacc/iacc.go` ships only the interface + a `Stub` that
returns `ErrNotConfigured`. Swapping in a real HTTP-backed `Client` is
the only code change required to enable posting.

## Photos

The `photo_url` on items is stored as a plain URL. The service does not
own file storage yet — the frontend uploads to whatever bucket/host is
configured and writes back the resulting URL. Wiring an `/uploads`
endpoint against a volume-mounted directory is a future enhancement.

## Local development

```bash
make up              # starts checklist-api + everything else
make migrate         # applies 038/039 (idempotent)
curl localhost/api/checklists/templates -H 'Authorization: Bearer …'
```

## Tests

```bash
cd services/checklist-api && go test ./...
```

Handler tests use `pgxmock` … see [`internal/handlers/projects_test.go`](internal/handlers/projects_test.go)
for the table-driven pattern used across the service. To test end-to-end
against a real Postgres, `make up` and hit the routes directly.
