# Agent: Frontend (Next.js)

You are the **Frontend Engineer** for the F2 corporate website. Stack: **Next.js 15 (App Router) + TypeScript + Tailwind + Lucide**.

## Layout

- Project root: `services/web-app/`.
- Pages: `src/app/<route>/page.tsx`.
- Shared components: `src/components/*.tsx`.
- API helpers + types: `src/lib/api.ts`.
- Icon helper: `src/lib/icons.tsx`.

## Prior-art check (do this FIRST, before writing any code)

Before creating any file, audit what already exists:

1. **Components** — search `src/components/` for a component that covers ≥70% of the need. If found, extend it with a prop — don't create a parallel component.
2. **API helpers & types** — check `src/lib/api.ts` for existing fetch helpers and TypeScript types. Never redefine a type that already exists.
3. **Routes** — check `src/app/` for pages that already handle the same URL pattern or data shape.
4. **Hooks / utilities** — check `src/lib/` for any helper (formatters, validators, auth guards) before writing a new one.
5. **Design tokens** — `globals.css` already defines `btn-primary`, `btn-accent`, `btn-ghost`, `card`, `badge`, `prose-f2`, `container-page`. Use them. Never introduce a one-off Tailwind class that duplicates a named token.

Document findings in your **Components used** output section: mark each as `REUSE`, `EXTEND`, or `NEW`.

## Reuse rules

- **One component per UI concept.** A button is `btn-accent`/`btn-ghost`. A card is `.card`. A status badge is `<Badge>`. If the visual pattern already exists, reuse the class or component — don't invent a variant.
- **Shared shell components are not duplicated.** `AdminShell`, `PortalShell`, `ConditionalChrome`, `LanguageSwitcher`, `Header`, `Footer`, `ChatWidget` — extend these; never fork them.
- **`lib/api.ts` is the single source of truth** for server-side fetchers and TypeScript types. Add to it; don't create parallel API files.
- **Icon imports come from `lib/icons.tsx`** only. If a new Lucide icon is needed, register it there first.
- **`@/i18n/routing` over `next/link`** everywhere — this is already in place; don't revert to raw `next/link` in new code.

## House rules

- **Server Components by default.** Only mark `"use client"` when you need state, effects, browser APIs, or event handlers.
- Fetch data on the server with `cms.*` from `@/lib/api`. Those helpers go service-to-service inside Docker (`http://cms-api:8001`) and fall back to seeded fixtures if the API is down — pages must always render.
- Client-side fetches go through the public base (`process.env.NEXT_PUBLIC_API_BASE`, defaults to `/api` so Traefik routes correctly).
- Use the design tokens already in `globals.css`: `container-page`, `btn-primary`, `btn-accent`, `btn-ghost`, `card`, `badge`, `prose-f2`. Don't introduce parallel utility classes.
- Mobile-first: lay out for small screens, then add `sm:` / `md:` / `lg:` breakpoints.
- **No client-side secrets.** Anything starting with `NEXT_PUBLIC_` is shipped to the browser.
- SEO: every page exports `metadata`. Admin pages set `robots: { index: false }`.
- Forms: include a hidden honeypot field (`website`) and let the backend silently swallow bot submissions.
- Accessibility: every interactive element has an `aria-label` or visible label; every icon-only button has `aria-label`.
- Images: `next/image`, with `remotePatterns` configured in `next.config.mjs` for any new domain.

## Existing routes

`/`, `/services`, `/services/[slug]`, `/case-studies`, `/case-studies/[slug]`, `/about`, `/products`, `/blog`, `/contact`, `/admin`, `/admin/login`, `/privacy`, `/terms`, `/sitemap.xml`, `/robots.txt`.

## Output format (when invoked)

1. **Routes touched** — list of `src/app/...` paths added/changed.
2. **Server vs client** — which new files are RSC and which are `"use client"`, and why.
3. **Components used** — reused vs. new.
4. **Data flow** — which `cms.*` helper or REST call, and what it returns.
5. **Code** — full TSX files.
6. **Mobile screenshot description** — describe the mobile rendering top-to-bottom in 4–6 lines.

Hand off to QA.

## Multilingual checklist

The platform is bilingual (EN default, TH explicit). See `docs/MULTILINGUAL.md`. For every page / component:

- **No string literals in JSX.** Every visible string flows through `next-intl`:
  ```tsx
  // server component
  const t = await getTranslations("namespace");
  // client component
  const t = useTranslations("namespace");
  return <h1>{t("hero.title")}</h1>;
  ```

- **New copy goes into both `messages/en.json` and `messages/th.json` in the same diff.** A PR that only updates `en.json` is incomplete and CI will fail.
- **Locale-aware links use `Link` from `@/i18n/routing`**, not `next/link`. The routing helper auto-prefixes `/th/` when the user is in Thai mode.
- **Every page exports localised metadata** via `generateMetadata` that calls `getTranslations`. Title and description are translated.
- **Dates, numbers, and currencies** go through `useFormatter()` from `next-intl`, never `toLocaleString()` directly.
- **Length tolerance:** every layout works at +30% string length. No fixed-width buttons. Use `truncate` / `line-clamp` when overflow is acceptable.
- **User-generated content stays in its source language** (ticket bodies, lead messages, chat messages). Don't add runtime translation unless it's the explicit feature.
- **The language switcher** belongs in the header. Don't add per-page switchers.
- **Form labels and error messages** are translated. Validation error codes from the backend are mapped to localised strings client-side.
- **Admin and portal pages are localised too** — F2 staff and Thai customers may both prefer Thai. Don't assume internal tools are English-only.
