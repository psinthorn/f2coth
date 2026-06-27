import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

const intlMiddleware = createMiddleware(routing);

export default function middleware(request: NextRequest) {
  // Generate a fresh cryptographic nonce for every request so that
  // Content-Security-Policy can use 'nonce-<value>' instead of 'unsafe-inline'.
  const nonce = btoa(crypto.randomUUID());

  const csp = [
    "default-src 'self'",
    // 'strict-dynamic' lets nonce-approved scripts load further scripts
    // dynamically (required for Next.js runtime chunk loading).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    // Tailwind ships a single CSS file — no runtime style injection in prod.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://api.anthropic.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");

  // Let next-intl handle locale routing first (may return a redirect).
  const intlResponse = intlMiddleware(request);

  // For redirects (e.g. /en/... → /...) just attach the CSP and return.
  if (intlResponse.status !== 200) {
    intlResponse.headers.set("Content-Security-Policy", csp);
    return intlResponse;
  }

  // For pass-through responses, rebuild via NextResponse.next() so the nonce
  // is forwarded in the request headers. Next.js reads x-nonce from the
  // incoming request to automatically attach the nonce to its own inline
  // hydration <script> tags.
  const reqHeaders = new Headers(request.headers);
  reqHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers: reqHeaders } });

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
