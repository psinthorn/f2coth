import type { MetadataRoute } from "next";
import { cms } from "@/lib/api";
import { routing } from "@/i18n/routing";
import { getEnabledModulesRecord, isEnabledIn } from "@/lib/modules";

// Emit both EN and TH URLs for every translatable route.
// Default locale: no prefix (`/services`). Non-default: `/th/services`.
function p(locale: string, path: string): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://f2.co.th";
  if (locale === routing.defaultLocale) return `${base}${path === "/" ? "/" : path}`;
  return `${base}/${locale}${path === "/" ? "" : path}`;
}

// Static structural pages have no CMS row so lastModified reflects the
// last deploy — passed in as `deployTime` below. CMS-managed detail pages
// override that with their own `updated_at`.
const STATIC_PATHS: Array<[string, string]> = [
  ["/",             "public.home"],
  ["/services",     "public.services"],
  ["/case-studies", "public.case_studies"],
  ["/products",     "public.products"],
  ["/blog",         "public.blog"],
  ["/about",        "public.about"],
  ["/contact",      "public.contact"],
  ["/privacy",      "public.privacy"],
  ["/terms",        "public.terms"],
  ["/dpa",          "public.dpa"],
];

// Parse an ISO string into a Date, falling back to `now` when the field
// is missing or malformed. Crawlers treat a stable-old date better than
// a stable-new one, so we never lie in the "newer" direction.
function parseDate(iso: string | null | undefined, now: Date): Date {
  if (!iso) return now;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? now : d;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const enabled = await getEnabledModulesRecord();

  // Skip the cms-api round-trips entirely when their parent section is
  // off — saves a query and keeps the sitemap snappy for crawlers.
  const wantServices    = isEnabledIn(enabled, "public.services");
  const wantCaseStudies = isEnabledIn(enabled, "public.case_studies");
  const wantBlog        = isEnabledIn(enabled, "public.blog");

  const [services, studies, posts] = await Promise.all([
    wantServices    ? cms.listServices()     : Promise.resolve([]),
    wantCaseStudies ? cms.listCaseStudies()  : Promise.resolve([]),
    wantBlog        ? cms.listBlogPosts()    : Promise.resolve([]),
  ]);

  const now = new Date();

  // Two per-URL data channels:
  //   • moduleKey — gates whether the URL appears at all.
  //   • lastModified — the freshest CMS timestamp we know about.
  //
  // CMS detail pages carry their own `updated_at`. Static structural
  // pages get `now` today; if we ever store deploy times, this is the
  // single place to swap them in.
  type Entry = { path: string; moduleKey: string; lastModified: Date };

  const entries: Entry[] = [
    ...STATIC_PATHS.map(([path, moduleKey]) => ({ path, moduleKey, lastModified: now })),
    ...services.map((s) => ({
      path: `/services/${s.slug}`,
      moduleKey: "public.services",
      lastModified: parseDate(s.updated_at, now),
    })),
    ...studies.map((c) => ({
      path: `/case-studies/${c.slug}`,
      moduleKey: "public.case_studies",
      lastModified: parseDate(c.updated_at, now),
    })),
    ...posts.map((post) => ({
      path: `/blog/${post.slug}`,
      moduleKey: "public.blog",
      // Blog posts prefer `updated_at` for edits, falling back to
      // `published_at` if the row was never re-edited.
      lastModified: parseDate(post.updated_at ?? post.published_at, now),
    })),
  ];

  const out: MetadataRoute.Sitemap = [];
  for (const { path, moduleKey, lastModified } of entries) {
    if (!isEnabledIn(enabled, moduleKey)) continue;
    for (const locale of routing.locales) {
      out.push({
        url: p(locale, path),
        lastModified,
        alternates: {
          languages: Object.fromEntries(
            routing.locales.map((l) => [l, p(l, path)]),
          ) as Record<string, string>,
        },
      });
    }
  }
  return out;
}
