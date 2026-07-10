# contract-api

Contract Management microservice. F2's master service agreement acts as a
reusable skeleton: staff create a contract from a customer's details, generate
a print-ready PDF via the internal `docgen` service, and upload the signed scan
back onto the record. Multi-contract and multi-template.

- **Stack:** Go 1.22 · Chi · pgx/v5 · JWT (mirrors `checklist-api`)
- **Port:** 8008 (own container netns) · **Traefik:** `PathPrefix(/api/contracts)`
- **Storage:** generated docx/PDF + signed scans on the `contract-uploads`
  volume (never in Postgres). Metadata only in `contract_files`.
- **Docs:** `docgen` (internal, `http://docgen:8080`) renders documents.

## RBAC

| Role | Contracts |
|---|---|
| `admin` | full — create/edit/generate/upload/transition + **delete** + template mgmt |
| `editor` (tech) | **read-only** |
| `viewer` | read-only |

## Status lifecycle (server-enforced; illegal jumps → 409)

```
draft ──generate signing──▶ sent ──upload signed scan──▶ signed ──confirm──▶ active
  └── cancel ──▶ terminated       └── revert ──▶ draft            active ──▶ expired / terminated
```

## Endpoints (under `/api/contracts`)

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/` | staff | list; `?status=&party=&customer=&expiring=30` |
| POST | `/` | admin | create draft; allocates `doc_no` safely |
| GET | `/{id}` | staff | detail (party + files + timeline) |
| PATCH | `/{id}` | admin | merge data editable **only while draft** |
| DELETE | `/{id}` | admin | |
| POST | `/{id}/generate` | admin | `{watermark}` — false ⇒ signing version, draft→sent |
| POST | `/{id}/status` | admin | `{to, note, effective_date, end_date}` |
| POST | `/{id}/files` | admin | multipart signed scan (pdf/jpg/png ≤20 MB) → signed |
| GET | `/{id}/files/{fileId}` | staff | download/stream |
| GET/POST/PATCH | `/templates…` | staff read / admin write | code validated vs docgen |
| GET/POST/PATCH | `/parties…` | staff read / admin write | |

## Doc numbers

`F2-<PREFIX>-<YEAR>-<seq>` (e.g. `F2-AGR-2026-001`). Allocated inside the
create transaction via `contract_doc_seq` with `INSERT … ON CONFLICT DO UPDATE
RETURNING`, whose row lock serialises concurrent creates — unique and gap-free.

## Tests

```bash
go test ./...                         # state machine + doc-no formatting (hermetic)
TEST_DATABASE_URL=postgres://… go test ./internal/handlers -run Concurrent
```
