import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

// i18n middleware applies to ALL non-API paths now (Phase 3C). Public
// pages, /admin, and /portal all sit under app/[locale]/ and use locale
// routing. Static assets, _next, _vercel, sitemap, robots bypass.
export const config = {
  matcher: [
    "/((?!api|_next|_vercel|sitemap.xml|robots.txt|.*\\..*).*)",
  ],
};
