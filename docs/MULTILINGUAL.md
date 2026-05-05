# MULTILINGUAL.md — Platform-wide bilingual contract

**Status:** active. Every PM / Designer / DBA / Backend / Frontend / QA / Security / DevOps / Tracker / Reporter agent reads this first.
**Locales today:** `en` (default), `th`.
**Adding a locale later** = config + translation only. No schema change.

---

## Hard rules

1. **No hardcoded user-visible English in code.** Frontend strings flow through `next-intl`'s `useTranslations()` / `getTranslations()`. Any string a user might see is in `messages/en.json` and `messages/th.json`.
2. **Every translatable DB text field is JSONB**, shape `{"en": "...", "th": "..."}`. Single-language fields (slugs, codes, URLs, identifiers) stay TEXT.
3. **Fallback rule:** missing `th` → fall back to `en`. Missing `en` → log a warning. **Never** show `[undefined]`, an empty string, or `[missing translation]`.
4. **URL convention:** English at root (`/services`, `/portal`, `/admin`). Thai at `/th/...`. Default locale has no prefix; non-default locales always do.
5. **Authenticated users carry their locale.** `users.locale` and `customer_contacts.locale` (default `'en'`). UI loads in their preference; emails are sent in their locale.
6. **Forms accept Thai input.** All `TEXT` columns are UTF-8; never blame users for non-ASCII.
7. **Every PR that adds new copy adds it in both locales** in the same diff. Adding a key only to `en.json` is incomplete.

---

## URL strategy

| Path | Locale | Notes |
|---|---|---|
| `/`, `/services`, `/case-studies/sala-hospitality`, `/portal`, … | `en` | Default. No prefix. |
| `/th/`, `/th/services`, `/th/case-studies/sala-hospitality`, `/th/portal`, … | `th` | Explicit prefix. |

Implementation: `next-intl` middleware with `localePrefix: 'as-needed'` and `defaultLocale: 'en'`.

A link from `/th/services` to "case studies" must produce `/th/case-studies`. Use the `<Link>` exported from `@/i18n/routing`, not `next/link`, for any locale-relative navigation. (External absolute URLs and admin/portal nav can use `next/link` directly when the locale is implicit.)

### `<html lang>` and `hreflang`

- Each rendered page sets `<html lang="en">` or `<html lang="th">`.
- Each canonical page has `<link rel="alternate" hreflang="en" href="https://f2.co.th/services">` and `<link rel="alternate" hreflang="th" href="https://f2.co.th/th/services">` plus `<link rel="alternate" hreflang="x-default" href="https://f2.co.th/services">`.
- `sitemap.xml` includes both locales for every translatable URL.

---

## DB convention

### Translatable text → JSONB

All translatable text fields are JSONB columns whose value is a JSON object keyed by locale:

```json
{ "en": "IT Management Partner", "th": "พันธมิตรด้านการจัดการระบบไอที" }
```

Read pattern (server side):

```sql
SELECT COALESCE(title->>$1, title->>'en') AS title FROM services WHERE slug = $2
```

`$1` = the resolved locale (`'en'` or `'th'`). The Go layer always also has `'en'` as a fallback baked into the SQL.

Search pattern (full-text):

```sql
CREATE INDEX idx_services_search ON services USING GIN (
  to_tsvector('simple',
    COALESCE(title->>'en','') || ' ' || COALESCE(title->>'th','') || ' ' ||
    COALESCE(short_summary->>'en','') || ' ' || COALESCE(short_summary->>'th','')
  )
);
```

Indexed across both locales so a Thai search hits Thai content, English search hits English.

### When NOT to use JSONB

| Field type | Storage |
|---|---|
| Slug, code, identifier | `TEXT` (English-style ASCII; one canonical value) |
| Email, URL, phone | `TEXT` / `CITEXT` |
| Enum-like status / role | `TEXT` + CHECK |
| Timestamp, UUID, money | native types |
| **User-generated content** (lead message, ticket body, chat message) | `TEXT` — store the original; do not pretend it's translated |

### Migrations

When adding a new translatable column to an existing table:

1. Add the column as JSONB with `DEFAULT '{}'::jsonb`.
2. Backfill `{ "en": old_text }` from any pre-existing TEXT column.
3. Drop the old TEXT column (or keep it for a deprecation window — explicit decision per migration).
4. Add a CHECK so `field ? 'en'` (the English key MUST be present) — empty Thai is allowed, missing English is not.

Example skeleton:

```sql
ALTER TABLE services ADD COLUMN title_i18n JSONB NOT NULL DEFAULT '{}'::jsonb;
UPDATE services SET title_i18n = jsonb_build_object('en', title);
ALTER TABLE services ADD CONSTRAINT services_title_i18n_has_en CHECK (title_i18n ? 'en');
ALTER TABLE services DROP COLUMN title;
ALTER TABLE services RENAME COLUMN title_i18n TO title;
```

---

## Backend convention (Go services)

1. **Resolve locale once per request**, in middleware:
   - Prefer the explicit `locale` query param if present (set by Next.js when proxying).
   - Otherwise parse `Accept-Language`. Match against `{en, th}`. Default to `en` on no match.
   - Store on `r.Context()` under a dedicated key.
2. **Handlers consume locale via context**, never via raw header parsing.
3. **Every API response that returns user-visible strings has resolved them.** Never return raw JSONB to public callers; resolve to a string with the COALESCE pattern. Admin endpoints CAN return raw JSONB (so the admin UI can edit both languages).
4. **Validation errors** use stable machine-readable codes (e.g. `"error_code": "email_required"`). The frontend localises the code into a friendly string. Free-text error messages from Go are English-only debug strings, never user-facing.

---

## Frontend convention (Next.js)

### Strings

```tsx
// ❌ never
<h1>Talk to F2</h1>

// ✅ always
import { useTranslations } from "next-intl";
const t = useTranslations("contact");
<h1>{t("hero.title")}</h1>
```

`messages/en.json`:
```json
{ "contact": { "hero": { "title": "Talk to F2" } } }
```

`messages/th.json`:
```json
{ "contact": { "hero": { "title": "ติดต่อ F2" } } }
```

### Links and routes

```tsx
// ❌ next/link for anything that should be locale-aware
import Link from "next/link";

// ✅ locale-aware link
import { Link } from "@/i18n/routing";
<Link href="/services">{t("nav.services")}</Link>
```

### Server components

```tsx
import { getTranslations } from "next-intl/server";

export default async function ServicesPage() {
  const t = await getTranslations("services");
  // ...
}
```

### Date / number formatting

```tsx
import { useFormatter } from "next-intl";
const format = useFormatter();
format.dateTime(date, { dateStyle: "long" });
format.number(value);
```

Don't use `toLocaleString()` directly — it doesn't honor the `next-intl` locale.

### Locale length tolerance

Thai text is typically **20–30% longer** than equivalent English (compound nouns, no inter-word spaces). Any layout that's tight in English MUST be tested in Thai before merging. Avoid fixed-width buttons; truncate with ellipsis where overflow is acceptable.

### Mixed-locale UX

User-generated content stays in whatever language the user wrote it. A SALA contact who writes a ticket in Thai sees a Thai ticket on their portal AND in F2 staff's admin queue (we don't translate the body at runtime). Only **system chrome** is localised.

---

## Email convention

`notifications` jobs include a `locale` field. The `notification-api` worker:

1. Picks the template variant matching the recipient's locale (e.g. `body_tmpl` is JSONB with `{en, th}`).
2. Falls back to `en` if the recipient's locale variant is empty.
3. Renders Mustache-style placeholders the same way regardless of locale.

Notification publishers (lead-api, customer-api) MUST pass the recipient's locale on the job:

- For **leads**: the language the visitor was browsing in (read from `Accept-Language` on the contact form POST).
- For **customer contacts**: `customer_contacts.locale`.
- For **F2 staff alerts**: `users.locale` (or `en` for `SALES_NOTIFY_TO` shared inbox).

---

## Chatbot convention

The Anthropic Claude system prompt already instructs the assistant to reply in Thai if the user writes in Thai. We keep that, AND add an explicit toggle in the widget header (EN / TH). The toggle, when set, sends `locale: "th"` in the request body and the system prompt prepends "Reply in Thai." for that turn. Auto-detect remains the fallback when no explicit toggle.

---

## QA convention

Every test plan runs at **both locales** by default. The matrix from any agent's QA section is duplicated:

| Scenario | EN result | TH result |
|---|---|---|
| Home renders | … | … |
| Header CTA visible at 360px | … | … |
| Form validates email | … | … (Thai error message present) |

Visual regression at one mobile viewport (360×640) for **both** locales. Length-overflow checks: any text that wraps to a 3rd line in EN must be visually inspected in TH.

---

## Security convention

- **Locale is a whitelist.** Any locale value coming from a request is matched against `{en, th}` before use; any other input is silently coerced to `en`. Never reflect locale into HTML or SQL unsanitised.
- **Path-based locale prefixes** (`/th/...`) MUST be normalised — `/Th/`, `/TH/` etc. should canonicalise or 404.
- **Cookies** holding locale (`f2_locale`) are `SameSite=Lax`, no sensitive data.

---

## DevOps convention

- `messages/*.json` are bundled into the Next.js Docker image at build time (no runtime fetch).
- Adding a new locale = update `i18n/routing.ts`, add `messages/<locale>.json`, ship.
- The CI build must fail if `messages/th.json` and `messages/en.json` have **different key sets** (use a small `npm run i18n-check` that walks both trees).

---

## Tracker convention

Every feature ticket has, by default, two sub-tasks:

- [ ] EN copy ready
- [ ] TH copy ready

Closing the parent ticket without both is a process violation. The `Tracker` agent surfaces this in weekly reports.

---

## Reporter convention

- Internal team email digests can stay English (audience is F2 staff defaulting to EN).
- **External-facing artefacts** — anything that may be forwarded to a Thai client — must have a Thai variant or be explicitly marked "EN only".

---

## Adding a new locale (future)

1. Add the locale code to `frontend/i18n/routing.ts` (`locales: ['en', 'th', 'lo']` for example).
2. Create `messages/lo.json`. CI fails until parity with `en.json` keys.
3. Backfill: every JSONB content row gets a `lo` key (initially copied from `en` so nothing breaks; translation work follows).
4. Ship.

No schema change. No code rewrite. That's the whole point of the JSONB shape.
