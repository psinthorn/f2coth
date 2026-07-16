# docgen

Internal document-generation service for `contract-api`. Renders bilingual
(EN/TH), F2-branded `.docx` + PDF from a template code + merge data. **Not**
exposed via Traefik — reachable only on `f2-net` at `http://docgen:8080`.

## API

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/healthz` | — | `{status, service, templates[]}` |
| `GET` | `/templates` | — | `{templates[]}` — registered builder codes (capability list) |
| `POST` | `/render` | `{template, data, watermark}` | `{docx_b64, pdf_b64}` |

`POST /render` returns **404** if `template` has no registered builder — never a
silent blank document.

## Pipeline

1. `lib/builders/<code>.js` renders the docx from `data` (watermark image
   included only when `watermark` is true).
2. `lib/embed-fonts.js` embeds Noto Sans Thai as obfuscated `.odttf` (mandatory
   — Thai renders on any machine, including the PDF converter).
3. `lib/to-pdf.js` converts to PDF via LibreOffice headless (in-container).

## Adding a template type (code-defined layouts)

1. Add `lib/builders/<code>.js` exporting `build(data, {watermark}) -> Document`
   (reuse `lib/shared/docx-kit.js` primitives).
2. Register it in `lib/builders/index.js`.
3. Seed a `contract_templates` row with matching `code` + `merge_schema`
   (see `database/migrations/055_seed_contract_templates.sql`).

No server/API/schema changes required. `contract-api` validates a template's
`code` against `GET /templates` on write, so an unrenderable template can't be
created.

## Local smoke test

```bash
npm install
node scripts/render-sample.js   # writes ./scripts/out/*.docx (PDF needs soffice)
```

Builders + font embedding run without LibreOffice; only the PDF step needs
`soffice`, which is installed in the container image.
