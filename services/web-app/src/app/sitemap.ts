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

// Each entry maps a sitemap path to the module that gates it. Disabled
// modules are omitted from the sitemap so Googlebot doesn't accumulate
// 404s for soft-launched sections. Core modules (home/contact/privacy/
// terms) are listed too — their entry is always-on per modules.core but
// reading from the same map keeps a single source of truth.
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

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const enabled = await getEnabledModulesRecord();

  // Skip the cms-api round-trips entirely when their parent section is
  // off — saves a query and keeps the sitemap snappy for crawlers.
  const wantServices    = isEnabledIn(enabled, "public.services");
  const wantCaseStudies = isEnabledIn(enabled, "public.case_studies");

  const [services, studies] = await Promise.all([
    wantServices    ? cms.listServices()     : Promise.resolve([]),
    wantCaseStudies ? cms.listCaseStudies()  : Promise.resolve([]),
  ]);
  const now = new Date();

  const dynamicPaths: Array<[string, string]> = [
    ...services.map((s) => [`/services/${s.slug}`,         "public.services"] as [string, string]),
    ...studies.map((c) =>  [`/case-studies/${c.slug}`,     "public.case_studies"] as [string, string]),
  ];
  const allPaths: Array<[string, string]> = [...STATIC_PATHS, ...dynamicPaths];

  const out: MetadataRoute.Sitemap = [];
  for (const [path, moduleKey] of allPaths) {
    if (!isEnabledIn(enabled, moduleKey)) continue;
    for (const locale of routing.locales) {
      out.push({
        url: p(locale, path),
        lastModified: now,
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
