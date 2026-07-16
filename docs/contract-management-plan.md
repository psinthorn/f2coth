# Contract Management Module — Implementation Plan

**Status:** awaiting sign-off · **Author:** AI pipeline · **Date:** 2026-07-07
**Scope:** F2 master service agreement → per-customer contract → print-ready PDF → signed-scan upload.

This plan is grounded in the Phase 0 audit of the live repo (53 migrations, 11 services). It maximises reuse of the **already-built** `checklist-api` (Projects), the existing **volume upload** mechanism, the **iACC client stub**, and the **docgen skeleton** in `docs/contract-template-skeleton/`.

---

## 0. Phase 0 findings (recap)

| Concern | Reality in repo | Decision |
|---|---|---|
| Projects/checklist module | **Built** — `checklist-api` (port 8008), `projects` table (mig 038–041), Miskawaan seeded, `iacc_company_id` column | **REUSE** — `contracts.project_id` → `projects(id)` (nullable). Offer "create linked project". |
| Customer legal-entity data | `customers` (mig 009) is thin: `slug, name, primary_contact_*`. No `tax_id`/`legal_name_*`/`address` | **NEW `contract_parties` table** (per your decision), with optional FK back to `customers(id)`. |
| File storage | Two mechanisms: (a) `attachments`/`payment_slip_files` = BYTEA inline; (b) `checklist-api/uploads.go` + `checklist-uploads` **Docker volume**, UUID filenames, `SaveFile/OpenFile` seam | **REUSE (b)** — spec mandates volume, never Postgres. New `contract-uploads` volume. |
| iACC integration | `checklist-api/internal/iacc/iacc.go` — `Client` iface + `Stub` + `InvoiceDraft` | **REUSE** — copy iface into `contract-api`; write drafts to an outbox on status→active. |
| Service skeleton | `checklist-api`: Chi + pgx, `RequireAuth/RequireStaff/RequireAdmin`, `modulegate`, distroless Dockerfile, config | **CLONE** as `contract-api` template. |
| Module toggle | `modules` table + `/admin/features` (live) | **NEW rows** `api.contracts`, `service.docgen`. |
| docgen skeleton | `make_agreement.js` (fully hardcoded Miskawaan), `embed_fonts.py`, Noto TTFs, logo, watermark | **REUSE + parameterise** — wrap in a Node service. |

**Verdict tags:** REUSE (projects, uploads, iacc, skeleton, service layout, modules) · EXTEND (nothing destructive) · NEW (`contract-api`, `docgen`, `contract_parties`+contract tables, `/admin/contracts`).

---

## 1. Port & routing allocation

Internal `SERVICE_PORT` is per-container, so "next free port" is cosmetic. Assignment:

| Service | Internal port | Traefik | Notes |
|---|---|---|---|
| `contract-api` | 8008 (its own netns; mirror checklist) | `PathPrefix(/api/contracts)` + tight rate-limit router on `Path(/api/contracts/*/files)` | staff-only, JWT |
| `docgen` | 8080 | **none** — internal only, reachable at `http://docgen:8080` on `f2-net` | no auth surface exposed publicly |

---

## 2. Database — migrations 054 & 055

### `054_contract_management.sql`
```
contract_parties            -- the "customer" on a contract (legal entity)
  id UUID pk
  customer_id UUID NULL REFERENCES customers(id) ON DELETE SET NULL   -- optional link to portal account
  legal_name_en TEXT NOT NULL
  legal_name_th TEXT NOT NULL
  brand_name    TEXT
  tax_id        TEXT
  address       TEXT
  notice_email  CITEXT
  contact_person TEXT
  phone         TEXT
  created_at/updated_at + set_updated_at() trigger

contract_templates
  id UUID pk
  code TEXT UNIQUE            -- 'service-agreement', 'mutual-nda', ... == docgen builder key
  name TEXT                   -- editable in admin
  version TEXT                -- '1.0'
  merge_schema JSONB NOT NULL -- drives the wizard form (field defs, defaults, order)
  is_active BOOLEAN DEFAULT true
  created_at/updated_at
  -- `code` MUST map to a builder registered in docgen (see §4). contract-api
  -- validates this against docgen's GET /templates capability list on write,
  -- so admin can add/edit/toggle templates but cannot invent an unrenderable one.

contracts
  id UUID pk
  doc_no TEXT UNIQUE NOT NULL          -- 'F2-AGR-2026-001'
  template_id UUID REFERENCES contract_templates(id) ON DELETE RESTRICT
  party_id    UUID REFERENCES contract_parties(id)   ON DELETE RESTRICT
  project_id  UUID NULL REFERENCES projects(id)      ON DELETE SET NULL
  merge_data  JSONB NOT NULL           -- filled merge fields (snapshot)
  status TEXT NOT NULL DEFAULT 'draft'
         CHECK (status IN ('draft','sent','signed','active','expired','terminated'))
  effective_date DATE
  end_date       DATE
  fee_total      NUMERIC(12,2)
  created_by UUID REFERENCES users(id) ON DELETE SET NULL
  created_at/updated_at
  INDEX (status), (party_id), (end_date)  -- end_date for the 30-day expiry query

contract_files
  id UUID pk
  contract_id UUID REFERENCES contracts(id) ON DELETE CASCADE
  kind TEXT CHECK (kind IN ('generated_docx','generated_pdf','signed_scan'))
  filename TEXT
  storage_path TEXT           -- relative path inside the volume (never the bytes)
  mime_type TEXT
  size_bytes INT
  sha256 TEXT
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL
  created_at

contract_status_events      -- timeline / audit of transitions
  id UUID pk
  contract_id UUID REFERENCES contracts(id) ON DELETE CASCADE
  from_status TEXT
  to_status   TEXT NOT NULL
  note TEXT
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL
  created_at

contract_doc_seq            -- concurrency-safe per-year counter
  year INT PRIMARY KEY
  last_seq INT NOT NULL DEFAULT 0

iacc_outbox                 -- queued invoice-draft payloads (wire later)
  id UUID pk
  contract_id UUID REFERENCES contracts(id) ON DELETE CASCADE
  payload JSONB NOT NULL     -- {company_id, doc_no, fee_total, currency, ...}
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','sent','failed'))
  attempts INT DEFAULT 0
  last_error TEXT
  created_at/sent_at

-- modules toggle rows
INSERT INTO modules (key, area, name_en, name_th, ...) VALUES
  ('api.contracts', 'api', 'Contracts', 'สัญญา', ..., true, false, 91),
  ('service.docgen','api', 'Document Generation', 'สร้างเอกสาร', ..., true, false, 92);
```

### `055_seed_templates.sql` — seeds **two** templates (proves multi-template)

- `service-agreement` v1.0 — full IT-audit agreement `merge_schema` (§3 catalogue).
- `mutual-nda` v1.0 — a structurally *different* second type (parties + term + governing law, **no fee fields**) to exercise the builder registry end-to-end. A `website-care-plan` type is an easy future add (reuses the fee/term fields).

**Doc-no concurrency safety** (acceptance criterion): allocation runs inside the contract-create transaction —
```sql
INSERT INTO contract_doc_seq(year, last_seq) VALUES ($yr, 1)
ON CONFLICT (year) DO UPDATE SET last_seq = contract_doc_seq.last_seq + 1
RETURNING last_seq;
```
`ON CONFLICT ... DO UPDATE` takes a row lock, so concurrent inserts serialise → `F2-AGR-2026-001`, `-002`, … with no gaps or dupes. Formatted `F2-AGR-<year>-<seq:%03d>`. Doc-no prefix is per-template (`F2-AGR-…` for agreements, `F2-NDA-…` for NDAs) — the counter keys on `(year)` but the prefix comes from the template.

---

## 3. `merge_schema` — the field catalogue (drives wizard + docgen)

Derived from the audit of `make_agreement.js`. Each field: `key, type, label_en, label_th, required, default, group`.

| key | type | default | notes |
|---|---|---|---|
| `client_legal_name_en` | text | — | replaces `"Miskawaan Company Limited (...)"` |
| `client_legal_name_th` | text | — | rendered as `EN (TH)` in party panel + signature |
| `client_brand_name` | text | — | `"Miskawaan Beachfront Villas (MHG Villas)"` |
| `client_tax_id` | text | — | `0105549033541` |
| `client_address` | text | — | Koh Samui address |
| `client_notice_email` | email | — | fills `[________]` blanks in §11 |
| `effective_date` | date | — | fills the Effective Date line |
| `term_months` | int | `3` | §3 heading, §6, fee math |
| `fee_monthly` | money | `15000` | THB/month |
| `fee_total` | money | `45000` | = monthly × term (auto-suggested, editable) |
| `fee_total_words_en` | text | auto | "forty-five thousand baht" (auto from number, editable) |
| `fee_total_words_th` | text | auto | "สี่หมื่นห้าพันบาทถ้วน" |
| `payment_terms` | enum(`advance`,`monthly`) | `advance` | §5 wording switch, 7-day due |
| `callout_fee` | money | `1500` | §4 emergency call-out |
| `service_area` | text | `Koh Samui` | §12 jurisdiction + area |
| `audit_schedule` | array[{month:int, scope_en, scope_th}] | 3-row default | §3 month→scope lines |
| `doc_no` | text | auto | set by API (`F2-AGR-…`), read-only in form |
| `watermark_text` | text | `"F2 SLA Draft"` | empty ⇒ no watermark (drafts on, signing off) |

**F2 provider defaults** (Tax ID `0845560003240`, `9/38 Moo 6, Bophut, Koh Samui, Surat Thani 84320`, `f2coltd@gmail.com`) live in **one config file** in the docgen service (`config/f2.js`) — never merge fields.

---

## 4. `docgen` service (Node 20, internal)

```
services/docgen/
  Dockerfile          FROM node:20-bookworm-slim; apt: libreoffice-core --no-install-recommends + fonts
  package.json        docx (pin exact version from skeleton's lockfile), express
  server.js           POST /render, GET /templates, GET /healthz
  config/f2.js        F2 provider constants + defaults
  lib/builders/
    index.js          BUILDER REGISTRY: { 'service-agreement': fn, 'mutual-nda': fn }
    service-agreement.js  ← parameterised make_agreement.js (literals → data.*)
    mutual-nda.js         ← scaffolded second layout (no fee fields)
  lib/shared/           common docx primitives extracted from the skeleton:
                        header/footer, watermark, party panel, signature block,
                        brand constants (NAVY/ACCENT/…), bilingual section table
  lib/embed-fonts.js  ← port of embed_fonts.py (odttf XOR obfuscation) to Node
  lib/to-pdf.js       soffice --headless --convert-to pdf
  assets/             f2-logo-color.jpeg, f2-watermark.png, NotoSansThai-{Regular,Bold}.ttf
```

**Builder registry** — `lib/builders/index.js` maps a template `code` → a render function.
Adding a new contract type later = drop one `lib/builders/<code>.js` (reusing `lib/shared/`
primitives) + register it + seed a `contract_templates` row. No server/API/schema changes.

**`GET /templates`** — returns the registered builder codes (capability list).
`contract-api` calls this to validate that any template admin creates/edits has a real
renderer behind it (this is what enforces "code-defined layouts").

**`POST /render`** — body `{ template:"service-agreement", data:{…merge fields…}, watermark:bool }` →

1. Look up `builders[data.template]` → **404 if unknown** (no silent blank doc).
2. Builder renders the bilingual `.docx` from `data` (watermark image included only when `watermark` true / `watermark_text` non-empty).
3. `embed-fonts` embeds Noto Sans Thai as obfuscated `.odttf` (mandatory — Thai renders anywhere).
4. `to-pdf.js` converts to PDF via LibreOffice headless (same container).
5. Returns both artifacts (multipart, or `{docx_b64, pdf_b64}`). `contract-api` persists them to the volume.

**Key parameterisations** (from audit): doc-no line, title block already generic; party panel client cells; effective-date line; §3 audit-schedule loop over `data.audit_schedule`; fee/total/words in §4–5 (EN+TH); call-out fee §4; term in §3/§6; service-area/jurisdiction §12; client notice-email blanks §11. Fonts move from `~/.fonts` → bundled `assets/` (removes the skeleton's `$HOME` dependency).

**docgen is not on Traefik** — only `contract-api` calls it over `f2-net`.

---

## 5. `contract-api` (Go, clones checklist-api)

```
services/contract-api/
  cmd/server/main.go            router, RBAC groups, healthz, graceful shutdown
  internal/config/config.go     + DocgenURL, UploadsDir
  internal/middleware/          copy auth.go + modulegate.go (RequireAuth/Staff/Admin)
  internal/models/models.go     Contract, Party, Template, File, StatusEvent
  internal/handlers/
    templates.go   GET/POST/PATCH /templates            (RequireAdmin write)
                   -- on POST/PATCH, validates `code` ∈ docgen GET /templates
                   -- (registered builders) → 422 if no renderer exists.
                   -- Admin edits name/version/merge_schema defaults/is_active;
                   -- the rendered layout stays code-defined.
    parties.go     CRUD /parties  (+ ?customer= link)
    contracts.go   CRUD + list/filter (?status=&party=&expiring=30)
    generate.go    POST /contracts/{id}/generate        → calls docgen, saves files
    files.go       POST /contracts/{id}/files (multipart, ≤20MB, pdf/jpg/png)
                   GET  /contracts/{id}/files/{fileId}   (auth download, streams from volume)
    status.go      transition helper (server-enforced state machine)
    uploads_store.go  SaveFile/OpenFile seam copied from checklist uploads.go
  internal/docgen/client.go     HTTP client → docgen POST /render
  internal/iacc/iacc.go         copy of the stub interface; QueueInvoiceDraft → iacc_outbox
  Dockerfile                    distroless, EXPOSE 8008, /data/uploads chowned nonroot
  README.md, e2e/contract_e2e.sh
```

**RBAC** (reuse existing roles): `admin` = full incl. delete + template mgmt; `editor` (tech) = read-only on contracts; `viewer` = read-only. Enforced at route groups + handler level, matching checklist-api.

**Status state machine** (server-enforced; illegal jumps → 409):
```
draft ──generate(signing)──▶ sent ──upload signed_scan──▶ signed ──confirm──▶ active
  │                                                                              │
  └── generate keeps draft (watermark on)                    active ──▶ expired / terminated
```
- Generating the **signing version** (no watermark) transitions `draft → sent`.
- Uploading a `signed_scan` prompts `→ signed`.
- Admin confirms `signed → active` with effective/end dates → also enqueues `iacc_outbox` row.
- Every transition writes a `contract_status_events` row (timeline).

**File upload**: `multipart/form-data` field `file`, allowlist `application/pdf,image/jpeg,image/png`, ≤20 MB, UUID filename on the `contract-uploads` volume; metadata (path/sha256/size) in `contract_files`. Works from a phone browser (same as checklist photo upload, which already targets phone cameras).

**Endpoints summary**
```
GET    /api/contracts?status=&party=&expiring=30
POST   /api/contracts                      (allocates doc_no, status=draft)
GET    /api/contracts/{id}
PATCH  /api/contracts/{id}                  (merge_data editable only while draft)
DELETE /api/contracts/{id}                  (admin only)
POST   /api/contracts/{id}/generate         {watermark:bool}
POST   /api/contracts/{id}/files            (multipart signed_scan → status signed)
GET    /api/contracts/{id}/files/{fileId}   (auth download)
GET/POST/PATCH /api/contracts/templates…
GET/POST/PATCH /api/contracts/parties…
```

---

## 6. Frontend — `services/web-app/src/app/[locale]/admin/contracts/`

Mirrors the existing `admin/projects` structure; API helper `src/lib/contract-api.ts` clones `checklist-api.ts` (same sessionStorage token + refresh pattern).

- **`page.tsx` — list**: table (doc no · customer · status badge · effective date · fee), filter by status/customer. Status badge colours: draft grey · sent amber · signed green · active navy `#1e293b` · expired red · terminated slate. Rows ending ≤30 days highlighted (renewal). A dashboard card counts expiring contracts.
- **`new/page.tsx` — wizard**: step 1 **pick template** (lists all active `contract_templates` — service-agreement, mutual-nda, …; the form in step 3 is generated from *that* template's `merge_schema`, so the wizard is fully template-agnostic) → step 2 pick/create party (reuses `contract_parties`, optional link to a `customers` account) → step 3 schema-driven form (defaults from the template, e.g. 3-month term / 15,000 THB/mo / prepaid for the agreement) with **live summary** → Create ⇒ `draft`. Optional "create linked project" checkbox (calls checklist-api when `api.attachments`/projects present).
- **`[id]/page.tsx` — detail**: editable merge data while `draft`; files panel (download docx/pdf, Print opens PDF); **"Generate signing version"** (regenerate, watermark off, `→ sent`); **"Upload signed copy"** drag-and-drop (`→ signed`, then confirm `active` + effective/end dates); status timeline from `contract_status_events`.
- **`templates/page.tsx` — admin template management**: list registered templates; edit name/version/`merge_schema` defaults and toggle `is_active`. **No layout authoring** (code-defined) — `code` is locked to a docgen builder; attempting an unknown code returns 422.
- **i18n**: EN + TH keys added to `messages/{en,th}.json` in the same change; `make i18n-check` must pass (CI gate).
- **Module toggle**: nav entry + pages respect `api.contracts` via the existing features gate.

---

## 7. Integration hooks (design now, wire later)

- **Projects link**: `contracts.project_id` FK + wizard checkbox; on "create linked project" call checklist-api to spin a project with the audit-schedule modules pre-attached (best-effort; skipped if module off).
- **iACC**: on `→ active`, insert an `iacc_outbox` row (`company_id` from `projects.iacc_company_id` if linked, `doc_no`, `fee_total`, currency THB). `internal/iacc/` holds only the stub `Client` (copied) — no live calls. A future worker drains the outbox.

---

## 8. Compose & Make wiring

- Add `docgen` (build `./services/docgen`, on `f2-net`, no Traefik labels) and `contract-api` (Traefik `/api/contracts`, `contract-uploads:/data/uploads`, `DOCGEN_URL=http://docgen:8080`, `depends_on: postgres`, healthcheck) to `docker-compose.yml`. New named volume `contract-uploads`.
- Migrations auto-run via existing `make migrate` (numbered 054/055).
- No changes to other services → **no regression**.

---

## 9. Tests & acceptance

- **Go table-driven**: (a) status-transition matrix (legal vs. illegal → 409); (b) doc-no generation incl. a concurrency test (N goroutines → unique sequential nos).
- **Playwright**: wizard happy path (new customer → create draft → generate → assert PDF file appears).
- **Manual acceptance** per spec: `make up` → docgen + contract-api healthy, template seeded; create contract → PDF has letterhead, correct Thai (embedded font), watermark on draft / off on signing; phone upload of signed scan → status `signed`; doc-nos increment safely.

---

## 10. Build order (on approval)

1. Migrations 054 + 055 (schema + seed **two** templates: service-agreement + mutual-nda).
2. `docgen` service — extract `lib/shared/` primitives, builder registry, `service-agreement` builder (verify it renders the exact branded doc), then the `mutual-nda` builder to prove the registry, LibreOffice, `/render` + `/templates`.
3. `contract-api` (clone checklist-api → tables, endpoints, template-code validation vs. docgen, state machine, doc-no, docgen client, iacc stub, uploads) + Go tests.
4. Compose + Make wiring; `make up` health check.
5. Frontend `/admin/contracts` (list · wizard · detail) + `contract-api.ts` + EN/TH i18n + module gate.
6. Playwright happy-path; `make ci` (fmt + test + i18n-check) green.
7. Memory write-back (`pipeline-runs.md`, `project.md`, `entities.md`).

---

### Decisions locked
- **Multi-contract & multi-template** — many contracts, many parties, many templates. Wizard/API/DB are template-agnostic; **rendered layouts are code-defined** via the docgen builder registry (§4). Seeds two types day one: `service-agreement` + `mutual-nda`.
- **Template authoring** — admin edits template name/version/merge-schema defaults + toggles active; new *layouts* are added by developers (builder file + seed row), validated by docgen `GET /templates`.
- **`contract_parties` ↔ `customers`** — separate table, optional FK to `customers(id)` so a party can link to a portal account without requiring one.

### Open questions for sign-off

1. **`docgen` Thai-font embedding** — port `embed_fonts.py`'s odttf XOR to Node (one dependency fewer, all-JS container) **or** keep `python3 embed_fonts.py` in the container (proven code, adds a Python dep)? *Recommendation: port to Node.*
2. **PDF conversion** — LibreOffice headless in the docgen image (~300 MB) is the spec's approach; acceptable, or prefer a lighter renderer? *Recommendation: LibreOffice per spec — fidelity matters for a signed legal doc.*
3. **Second template choice** — I picked **`mutual-nda`** as the scaffolded second type (structurally different — no fees — so it exercises the registry well). Prefer a different one (e.g. `website-care-plan`, `hosting-agreement`)? *Recommendation: keep `mutual-nda`; care-plan is an easy later add.*
