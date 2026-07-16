# assethub-api

F2 **AssetHub** — IT asset discovery & inventory. Multi-tenant device register
for MSP hotel/SMB clients, folded into the F2 monorepo (not the standalone app
its starter spec describes). Reuses the house stack: Go + chi + pgxpool, the
shared `f2_website` Postgres, JWT HS256 auth, the generic `audit_log`, the
module gate, `docgen` for PDF/DOCX, and notification-api for email.

Internal port **8010** · Traefik prefix **`/api/assethub`** · module keys
`api.assethub` / `admin.assethub` / `portal.assethub`.

## Tenancy

The AssetHub "org" **is** an existing `customers` row — no parallel org table.
A customer has many `assethub_sites`. Isolation is enforced in SQL on
`customer_id` (the JWT `customer_id` claim for portal, or the resolved
enrollment token for ingest). No Postgres RLS.

## Auth models

| Surface | Auth | Roles |
|---|---|---|
| `/ingest`, `/discovery`, `/enroll` | **Enrollment token** (Bearer, peppered SHA-256, `TOKEN_PEPPER`) | machine |
| `/admin/*` | staff JWT (`aud=staff`) | admin=superadmin, editor=engineer, viewer=read-only |
| `/portal/*` | customer JWT (`aud=customer`) | owner=org_admin, member=org_viewer |

## Endpoints

- `POST /ingest` — one collector payload (`f2.assethub.v1`); merges into the
  device register by identity precedence **serial → primary MAC → hostname+org**;
  stores the raw submission; replaces interface/disk/software child rows.
- `POST /discovery` — probe scan; stores a run + findings, auto-matches by MAC,
  unmatched → triage queue. Accepts the probe's `f2.assethub.discovery.v1`.
- `POST /enroll` — mobile self-registration (source=`manual`).
- `/admin/*` — orgs, overview, devices (filter/search/CSV/detail/history/patch/delete),
  sites & tokens CRUD, discovery triage (promote/ignore), report jobs.
- `/portal/*` — read-only register scoped to the caller's customer.

Ingest/discovery/enroll are rate-limited (Traefik 120/min per IP + in-process
`httprate` 60/min per token) with a 2 MB body cap.

## Reports

`POST /admin/reports` enqueues an `assethub_report_jobs` row. An in-process
worker (same binary, mirrors notification-api's DB-queue loop) renders:

- **xlsx** via `excelize` (Summary / Network / Computers / Software sheets),
- **pdf/docx** via the `assethub_handover` builder in `docgen` (Thai-capable font).

Files land on the `assethub-reports` volume; `GET /admin/reports/{id}/download`
streams them (path-traversal guarded).

## Collectors & probe

`agents/collect.sh`, `agents/collect.ps1`, `probe/discover.sh` are the upstream
F2 AssetHub scripts, repointed at `/api/assethub`. Point them with
`F2_SERVER_URL` + an enrollment token; nothing else changes.

## Local dev

```bash
make migrate                      # applies 065_assethub.sql
docker compose up -d assethub-api
# create a token in the admin UI (or seed one), then:
curl -X POST http://localhost/api/assethub/ingest \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d @sample-ingest.json
```

Migration `database/migrations/065_assethub.sql` seeds the `modules` rows,
adds `asset-management` to Miskawaan's `services_used`, and creates a default
site so ingest has a target.
