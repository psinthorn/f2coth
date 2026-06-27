# SEO / Optimization Specs — f2.co.th

Canonical reference for every optimization discipline this platform must
support. The reusable audit prompt for new pages and features lives at
[`ai/prompts/agent-seo.md`](../ai/prompts/agent-seo.md) — invoke it
whenever a feature, page, or content piece is in scope.

This document is the **what**. The agent prompt is the **how**. Both
must stay in sync; if you add a discipline here, update the prompt too.

---

## Posture

F2 sells IT services to Thailand's luxury hospitality sector. The site
must rank for:

1. Branded queries (`F2 Co Ltd`, `f2.co.th`).
2. Service-intent queries (`โรงแรม IT Bangkok`, `Microsoft 365 hospitality Thailand`).
3. Long-tail product queries (`.co.th domain price`, `cPanel hosting Thailand`).
4. Generative-AI answers — when a hotelier asks ChatGPT, Gemini, or
   Perplexity for "trusted IT partner for hospitality in Thailand", F2
   should be in the cited sources.

Bilingual EN + TH is non-negotiable for all of the above.

---

## Disciplines

### 1. Technical SEO — the crawlable foundation

| What | Requirement | Where in F2 |
|---|---|---|
| Status codes | 200 for live, 404 for unmatched, 301 for moved, **never** 5xx in normal flow | `services/web-app/src/middleware.ts` + module-gate layouts return 404 cleanly |
| Sitemap | `/sitemap.xml` lists every enabled, locale-prefixed URL with `<alternates>` for hreflang | [`services/web-app/src/app/sitemap.ts`](../services/web-app/src/app/sitemap.ts) — respects module toggles |
| robots.txt | Allow all crawlers on public routes; disallow `/admin`, `/portal`, `/api` | `services/web-app/src/app/robots.ts` (verify it exists; if not, add) |
| Canonical URLs | Each page emits exactly one `<link rel="canonical">` pointing to the EN URL by default; TH points to its own `/th/...` | `metadata.alternates.canonical` in each page's `generateMetadata` |
| hreflang | Every page emits `<link rel="alternate" hreflang="en">`, `hreflang="th">`, `hreflang="x-default">` | Root [`[locale]/layout.tsx`](../services/web-app/src/app/[locale]/layout.tsx) `alternates.languages` |
| HTTPS | Lets Encrypt via Traefik, HSTS preload | `docker-compose.prod.yml` + `services/web-app/src/middleware.ts` CSP block |
| Core Web Vitals | LCP < 2.5s, INP < 200ms, CLS < 0.1 on 75th pct mobile | Measured via WebPageTest / CrUX; budget per page |
| Mobile-first | Responsive via Tailwind, no horizontal scroll, tap-targets ≥ 44px | Audit each page in Chrome devtools mobile view |
| Crawl budget | No infinite-scroll soft-walls, no duplicate URLs from query params | `useSearchParams` for non-canonical only |

### 2. On-page / Content SEO — what's on the page itself

| What | Requirement |
|---|---|
| `<title>` | Unique per page, ≤ 60 chars, primary keyword early; templated via `metadata.title.template` |
| Meta description | Unique, 140–160 chars, includes call to action |
| H1 | Exactly one per page, matches page intent |
| Heading hierarchy | H1 → H2 → H3, no skips, no styled `<div>` substitutes |
| Content depth | Service / case-study pages ≥ 600 words EN + TH parity |
| Internal links | Every page links to ≥ 2 sibling pages with descriptive anchor text |
| Keyword density | Natural; primary keyword in title + H1 + first 100 words + at least one H2 |
| Schema.org | See "Structured Data" §11 |
| Freshness | `lastModified` in sitemap reflects real edits; date in BlogPosting matches DB |

### 3. AEO — Answer Engine Optimization (Google AI Overviews, Bing Copilot)

| What | Requirement |
|---|---|
| FAQ blocks | Every service/product page has a "Frequently asked" section with `FAQPage` schema |
| Direct answer paragraphs | First paragraph after H1 answers the most likely query in 40–55 words |
| Definition-first phrasing | "X is …" sentences so engines extract clean snippets |
| HowTo schema | Procedure pages (setup, migration) use `HowTo` schema with numbered steps |
| Speakable | Mark answer paragraphs with `speakable` schema for voice readout |
| Tables | Comparable specs (hosting plans, domain prices) in real `<table>` markup, not flex divs |

### 4. GEO — Generative Engine Optimization (ChatGPT, Gemini, Perplexity)

| What | Requirement |
|---|---|
| Citation-friendly URLs | Stable, descriptive slugs that LLMs can quote (`/case-studies/sala-hospitality-microsoft-365` not `/case-studies/abc123`) |
| Factual density | Numbers, dates, named entities in plain text near the claim. "F2 has served SALA Hospitality since 2018" beats "long-standing partner" |
| Source attribution | When the page cites a stat, link the source — LLMs prefer citing pages that themselves cite |
| Author bylines | Blog posts include author `Person` schema with sameAs to LinkedIn |
| Brand consistency | Always "F2 Co., Ltd." or "F2" — never "F2 Company", "F2 IT", etc. Mismatches confuse entity disambiguation |
| Update cadence | Refresh hero stats annually; LLMs penalize stale numbers |
| No JS-only content | Critical answer text must be in initial HTML (SSR), not hydrated client-side |

### 5. LLMO / LLM SEO — being recommended by LLMs

| What | Requirement |
|---|---|
| `llms.txt` | At `/llms.txt` per the [emerging convention](https://llmstxt.org/), list top URLs LLMs should crawl with one-line descriptions |
| `llms-full.txt` | At `/llms-full.txt`, expanded markdown index of all canonical content for LLM training crawlers |
| Markdown source | Each blog post / service page also reachable as `.md` for LLM ingestion (e.g. `/blog/foo.md`) |
| Schema completeness | `Organization`, `LocalBusiness`, `Service`, `Person`, `BreadcrumbList`, `Article`, `FAQPage` on every relevant page |
| Public Q&A | Customer-facing knowledge base, indexed and answered, signals expertise |

### 6. VSO — Voice Search Optimization

| What | Requirement |
|---|---|
| Conversational queries | Pages title and H1 should also work as a spoken question (e.g. "What does F2 offer for Bangkok hotels?") |
| Answer length | Voice assistants prefer ≤ 30-word answers right after the H1 |
| Local intent | "Near me" queries hit Local SEO §7; ensure NAP + service area schema |
| Pronunciation | Use plain Thai (no abbreviations like "บ.จก.") for brand mentions LLMs/TTS will speak |

### 7. Local SEO — Bangkok and Thai hospitality regions

| What | Requirement |
|---|---|
| NAP consistency | Name + Address + Phone identical on every page footer, schema, Google Business Profile, Line OA |
| LocalBusiness schema | `geo.latitude`, `geo.longitude`, `areaServed` (Bangkok, Phuket, Hua Hin, Samui, Krabi), `openingHours` |
| Google Business Profile | Owned, verified, weekly posts; reviews answered in EN+TH |
| Local citations | TAT (Tourism Authority of Thailand), Chamber of Commerce, hotel-association directories |
| TH-language pages | Thai content for every locale-relevant query, not auto-translation |
| `/contact` with embedded map | Real `<iframe>` Google Maps embed for the listed address |

### 8. Off-page SEO — authority and trust signals

| What | Requirement |
|---|---|
| Backlinks | Pursue mentions from hotel-tech press (Hotel Tech Report, Skift Thailand), TAT, partner sites |
| Partner schema | Use `sameAs` to Microsoft Partner Center, THNIC, ResellerClub partner pages |
| Press kit | `/press` page (when ready) with logos, founder bios, contact for journalists |
| Brand mentions | Monitor with Brand24 / Google Alerts; unlinked mentions → reach out for link |
| Disavow file | Audit Search Console quarterly; disavow obvious link-farm domains |

### 9. CRO — Conversion Rate Optimization

| What | Requirement |
|---|---|
| Primary CTA | Every page has a single dominant CTA above the fold ("Talk to F2", "Get a quote") |
| Lead form | ≤ 4 required fields; multi-step OK only if proven to lift submit-rate |
| Trust badges | Client logos (SALA, Miskawaan, Putahracsa) above the fold on home + services |
| Social proof | Real quote + headshot + role + property on case-study pages |
| Form analytics | Field-level drop-off tracked (post-launch; tool TBD) |
| A/B testing | Tag experiment ID in lead.source; never split-test pages that affect SEO without canonical |
| Page speed | LCP affects conversion directly — keep hero image lazy and AVIF |
| Friction reduction | No "verify email" before lead capture; verification belongs to DSR flow only |

### 10. Image SEO

| What | Requirement |
|---|---|
| Filename | Descriptive kebab-case (`sala-phuket-villa-night.avif`) |
| Format | AVIF first, WebP fallback, JPEG legacy; emit `<picture>` with `<source type="image/avif">` |
| Responsive | `srcset` + `sizes` for every hero/portrait; Next.js `<Image>` handles this |
| Alt text | Required on every `<img>`. Decorative = `alt=""`. Real content = sentence describing what's in the image |
| Lazy loading | `loading="lazy"` everywhere except above-the-fold |
| Dimensions | Always set `width` + `height` (no CLS) |
| ImageObject schema | Hero / OG images include schema for image search |
| OG / Twitter cards | `og:image` 1200×630 PNG/JPG per page, `twitter:card` = `summary_large_image` |

### 11. Video SEO

| What | Requirement |
|---|---|
| `VideoObject` schema | Embedded videos include `name`, `description`, `thumbnailUrl`, `uploadDate`, `duration`, `contentUrl` |
| Transcript | Every video has a visible transcript on the page — searchable + accessible |
| Captions | `.vtt` captions in EN + TH |
| Thumbnail | Custom thumbnail with text overlay (not a frame grab) |
| Hosting | YouTube for marketing reach; self-host (`<video>`) only for autoplay loops with no audio |
| Sitemap | Video pages declared in `sitemap.xml` with `<video:video>` extension |

### 12. Structured Data — schema.org reference

Required types and where they live:

| Type | Where |
|---|---|
| `Organization` | Site-wide, emitted from root layout |
| `LocalBusiness` (extends Organization) | `/about` + `/contact` |
| `WebSite` with `SearchAction` | Root layout (enables site-link search box in SERPs) |
| `BreadcrumbList` | Every non-home page |
| `Service` | Each `/services/{slug}` |
| `BlogPosting` + `Person` (author) | Each `/blog/{slug}` |
| `FAQPage` | Service + product pages with FAQ sections |
| `HowTo` | Procedural docs and migration guides |
| `Article` | Long-form non-blog editorials |
| `Product` + `Offer` | Domain + hosting plan listings |
| `Review` + `AggregateRating` | Only with real, dated reviews (never fabricate) |
| `VideoObject` | Every embedded video |
| `ContactPoint` | Inside Organization for support email/phone/LINE |

JSON-LD emitted in the page `<head>` (server-rendered), not injected
client-side. Use a single typed helper:
`services/web-app/src/lib/schema.ts` (to be built when first needed) so
all pages emit the same Organization fields.

---

## Audit checklist (per page — printable)

When PM invokes `agent-seo` on a page, the output must cover:

- [ ] Status codes (200/301/404/410 correct, no 5xx on normal flow)
- [ ] `<title>` unique, ≤ 60 chars, keyword in front
- [ ] Meta description 140–160 chars, unique, includes CTA
- [ ] Single H1 matching intent
- [ ] Heading hierarchy clean (no skips, no fake H1s)
- [ ] Canonical URL present and correct
- [ ] hreflang set for all locales + x-default
- [ ] Open Graph + Twitter Card (with valid 1200×630 image)
- [ ] At least one schema.org block, valid per Rich Results Test
- [ ] FAQ schema if FAQ block exists
- [ ] All images: alt, width, height, lazy, AVIF/WebP
- [ ] All videos: VideoObject schema + transcript + captions
- [ ] Primary CTA above fold, single dominant action
- [ ] Internal links ≥ 2 to sibling pages with descriptive anchor
- [ ] TH parity verified via `npm run i18n-check`
- [ ] LCP < 2.5s mobile, CLS < 0.1 (WebPageTest after deploy)
- [ ] `llms.txt` updated if the URL is canonical content
- [ ] Page included in `sitemap.ts` mapping with correct moduleKey
- [ ] Render passes both `/blog` (default-locale) and `/th/blog`
- [ ] No client-only critical content (test with JS disabled)
- [ ] CRO: lead form / CTA tracked with `lead.source` distinct value

---

## Verification tools

| Tool | Used for |
|---|---|
| Google Search Console | Coverage, Core Web Vitals, search performance, manual actions |
| Bing Webmaster | Indexing on Bing (still ~3% but feeds Copilot) |
| Rich Results Test (`search.google.com/test/rich-results`) | Validate schema |
| Schema Markup Validator (`validator.schema.org`) | Stricter than Google's, catches type mismatches |
| Mobile-Friendly Test | Mobile rendering check |
| PageSpeed Insights | Lab CWV |
| WebPageTest | Field-like CWV from multiple locations |
| Lighthouse CI | Wire into `make ci` once stable (deferred) |
| Screaming Frog | Periodic full-site crawl (200 URLs free tier covers F2) |
| Brand24 / Google Alerts | Off-page mention monitoring |

---

## What lives in code vs. what lives elsewhere

- **Code-owned:** sitemap, robots.txt, schema JSON-LD, metadata, hreflang,
  Image component, CSP, redirects, llms.txt
- **Content-owned:** titles, descriptions, body text, alt text, FAQ content,
  case-study quotes, blog cadence
- **Ops-owned:** Google Business Profile, backlink outreach, press
  relationships, review responses, GBP posts
- **Legal-owned:** privacy / terms / DPA copy (already shipped via PDPA pipeline)

The agent-seo prompt covers all four boundaries — when it flags a gap,
the PM agent routes to the right owner.
