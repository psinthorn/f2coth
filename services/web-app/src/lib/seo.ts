// SEO helpers used in every page's `generateMetadata` and JSON-LD blocks.
//
// Keeps each page's SEO scaffolding to 2-3 lines and centralises the URL
// math that powers canonical + hreflang alternates. Schema builders are
// in `lib/schema.tsx` (this file is for metadata + alternates + breadcrumb
// trail construction only).
//
// See docs/seo-specs.md for the requirements these helpers satisfy.

import { routing } from "@/i18n/routing";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://f2.co.th";

/**
 * Builds the canonical URL for a path in a given locale, respecting
 * `localePrefix: "as-needed"` (default locale at root, others under /th/...).
 * Always returns an absolute URL with no trailing slash for non-root paths.
 */
export function localizedUrl(locale: string, path: string): string {
  const normalised = path === "/" ? "" : path.startsWith("/") ? path : `/${path}`;
  if (locale === routing.defaultLocale) return `${SITE_URL}${normalised || "/"}`;
  return `${SITE_URL}/${locale}${normalised}`;
}

/**
 * Build the `alternates` object for next.js `Metadata` — canonical (this
 * locale) + `languages` for every supported locale + `x-default`.
 *
 *   export async function generateMetadata({ params }) {
 *     const { locale } = await params;
 *     return {
 *       title: …,
 *       alternates: pageAlternates(locale, "/services"),
 *     };
 *   }
 */
export function pageAlternates(locale: string, path: string) {
  const languages: Record<string, string> = {};
  for (const loc of routing.locales) {
    languages[loc] = localizedUrl(loc, path);
  }
  // x-default points crawlers at the canonical EN version when their
  // locale doesn't match any of ours.
  languages["x-default"] = localizedUrl(routing.defaultLocale, path);
  return {
    canonical: localizedUrl(locale, path),
    languages,
  };
}

/**
 * Build a BreadcrumbList input from a path + display labels for each
 * segment. Pass the deepest segment last. The function prepends "Home".
 *
 *   pageBreadcrumb(locale, [
 *     { name: "Services", path: "/services" },
 *     { name: "Microsoft 365", path: "/services/microsoft-365" },
 *   ], "Home")
 *
 * Returns the items array ready to pass to schema.breadcrumbList().
 */
export function pageBreadcrumb(
  locale: string,
  trail: Array<{ name: string; path: string }>,
  homeLabel: string,
): Array<{ name: string; url: string }> {
  return [
    { name: homeLabel, url: localizedUrl(locale, "/") },
    ...trail.map((t) => ({ name: t.name, url: localizedUrl(locale, t.path) })),
  ];
}

/**
 * Default OG/Twitter card metadata fragment — pages spread this into
 * their own `openGraph` to inherit defaults (type=website, site_name,
 * locale) without repeating themselves.
 */
export function pageOpenGraph(args: {
  locale: string;
  path: string;
  title: string;
  description: string;
  imageUrl?: string;
}) {
  const url = localizedUrl(args.locale, args.path);
  // Only include `images` when a caller explicitly passes imageUrl. Setting
  // `images: undefined` looks harmless but Next.js treats the presence of
  // the key as an override signal and skips the file-based
  // opengraph-image.tsx auto-injection. Omitting the key entirely lets the
  // file convention take over.
  const openGraph: Record<string, unknown> = {
    type: "website" as const,
    url,
    siteName: "F2 Co., Ltd.",
    locale: args.locale === "th" ? "th_TH" : "en_TH",
    title: args.title,
    description: args.description,
  };
  const twitter: Record<string, unknown> = {
    card: "summary_large_image" as const,
    title: args.title,
    description: args.description,
  };
  if (args.imageUrl) {
    openGraph.images = [
      { url: args.imageUrl, width: 1200, height: 630, alt: args.title },
    ];
    twitter.images = [args.imageUrl];
  }
  return { openGraph, twitter };
}
