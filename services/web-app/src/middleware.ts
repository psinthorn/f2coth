import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

const intlMiddleware = createMiddleware(routing);

// Origins the browser is allowed to fetch from (CSP connect-src).
// Derived from NEXT_PUBLIC_API_BASE so a Vercel deployment pointing at a
// cross-origin Go API (e.g. https://api.f2.co.th) doesn't get blocked.
function extraConnectOrigins(): string {
  const base = process.env.NEXT_PUBLIC_API_BASE;
  if (!base) return "";
  try {
    const u = new URL(base);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
}

export default function middleware(request: NextRequest) {
  // Generate a fresh cryptographic nonce for every request so that
  // Content-Security-Policy can use 'nonce-<value>' instead of 'unsafe-inline'.
  const nonce = btoa(crypto.randomUUID());

  const connectSrc = ["'self'", "https://api.anthropic.com", extraConnectOrigins()]
    .filter(Boolean)
    .join(" ");

  const csp = [
    "default-src 'self'",
    // 'strict-dynamic' lets nonce-approved scripts load further scripts
    // dynamically (required for Next.js runtime chunk loading).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    // Tailwind ships a single CSS file — no runtime style injection in prod.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");

  // Let next-intl handle locale routing first (may return a redirect or
  // an INTERNAL rewrite, e.g. /blog → /en/blog for the default locale with
  // `localePrefix: "as-needed"`).
  const intlResponse = intlMiddleware(request);

  // For redirects (e.g. /en/... → /...) just attach the CSP and return.
  if (intlResponse.status !== 200) {
    intlResponse.headers.set("Content-Security-Policy", csp);
    return intlResponse;
  }

  // For pass-through and rewrite responses we still need to add the nonce to
  // the REQUEST headers (so Next.js stamps inline hydration scripts) — which
  // means rebuilding the response. If next-intl emitted an internal rewrite
  // (signalled by `x-middleware-rewrite`), preserve that target URL so we
  // don't strip the rewrite by accident.
  const reqHeaders = new Headers(request.headers);
  reqHeaders.set("x-nonce", nonce);
  // Expose the raw URL pathname so the root layout can derive the URL locale
  // without calling next-intl's getLocale() (which would trigger the
  // request-scoped translations config early and pin messages to the default
  // locale — see app/layout.tsx).
  reqHeaders.set("x-pathname", request.nextUrl.pathname);

  const rewriteTarget = intlResponse.headers.get("x-middleware-rewrite");
  const response = rewriteTarget
    ? NextResponse.rewrite(rewriteTarget, { request: { headers: reqHeaders } })
    : NextResponse.next({ request: { headers: reqHeaders } });

  // Carry over any Set-Cookie headers next-intl set (locale persistence).
  intlResponse.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      response.headers.append(key, value);
    }
  });

  response.headers.set("Content-Security-Policy", csp);
  // Also expose nonce in the response so Server Components can read it via
  // headers() if they need to stamp additional inline scripts with the nonce.
  response.headers.set("x-nonce", nonce);
  return response;
}

// i18n middleware applies to ALL non-API paths now (Phase 3C). Public
// pages, /admin, and /portal all sit under app/[locale]/ and use locale
// routing. Static assets, _next, _vercel, sitemap, robots bypass.
export const config = {
  matcher: [
    "/((?!api|_next|_vercel|sitemap.xml|robots.txt|.*\\..*).*)",
  ],
};
