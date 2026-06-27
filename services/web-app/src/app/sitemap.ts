import type { MetadataRoute } from "next";
import { cms } from "@/lib/api";
import { routing } from "@/i18n/routing";

// Emit both EN and TH URLs for every translatable route.
// Default locale: no prefix (`/services`). Non-default: `/th/services`.
function p(locale: string, path: string): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://f2.co.th";
  if (locale === routing.defaultLocale) return `${base}${path === "/" ? "/" : path}`;
  return `${base}/${locale}${path === "/" ? "" : path}`;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [services, studies] = await Promise.all([cms.listServices(), cms.listCaseStudies()]);
  const now = new Date();

  const staticPaths = ["/", "/services", "/case-studies", "/products", "/blog", "/about", "/contact", "/privacy", "/terms", "/dpa"];
  const dynamicPaths = [
    ...services.map((s) => `/services/${s.slug}`),
    ...studies.map((c) => `/case-studies/${c.slug}`),
  ];
  const allPaths = [...staticPaths, ...dynamicPaths];

  const out: MetadataRoute.Sitemap = [];
  for (const path of allPaths) {
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
