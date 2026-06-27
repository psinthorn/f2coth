import type { MetadataRoute } from "next";

// Crawler policy:
//   • All locale-prefixed public routes are allowed.
//   • /admin and /portal are operator/customer-only surfaces — no SEO value
//     and would dilute the entity profile if indexed.
//   • /api is internal; no human reads it.
//   • Both /llms.txt and /llms-full.txt are explicitly allowed (default
//     anyway, but listed in the sitemap-style discovery hints so LLM
//     crawlers find them).
export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://f2.co.th";
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/portal", "/api"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
