import type { Metadata } from "next";
import { headers } from "next/headers";
import { routing } from "@/i18n/routing";
import "./globals.css";

// Root layout owns <html> + <body> only. Locale-aware chrome (Header /
// Footer / ChatWidget) lives in app/[locale]/layout.tsx; admin and portal
// have their own shells.
//
// We derive the URL locale from the request path here rather than calling
// next-intl's getLocale(). getLocale() would trigger getRequestConfig()
// before [locale]/layout.tsx has a chance to call setRequestLocale(), which
// poisons the request-scoped memo with the default locale — the site would
// then render every /th page with EN messages. Reading the path via the
// next/navigation-provided x-invoke-path / next-url header keeps this
// layout independent of next-intl's request cache.

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://f2.co.th"),
};

async function localeFromRequestPath(): Promise<string> {
  const h = await headers();
  const path = h.get("x-pathname") ?? "";
  for (const loc of routing.locales) {
    if (path === `/${loc}` || path.startsWith(`/${loc}/`)) {
      return loc;
    }
  }
  return routing.defaultLocale;
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await localeFromRequestPath();
  return (
    <html lang={locale}>
      <body className="min-h-screen bg-white text-navy-900 antialiased">
        {children}
      </body>
    </html>
  );
}
