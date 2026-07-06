import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { routing } from "@/i18n/routing";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";
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
  // PWA-friendly hints. manifest is served by app/manifest.ts, icons by
  // app/icon.tsx + app/apple-icon.tsx — Next automatically injects the
  // matching <link> tags when those files exist, but the app-name +
  // status-bar hints for iOS still have to be set explicitly here.
  appleWebApp: {
    capable: true,
    title: "F2",
    statusBarStyle: "black-translucent",
  },
  // applicationName maps to <meta name="application-name">, used by
  // Windows tile + some launchers when the PWA is installed.
  applicationName: "F2 Co., Ltd.",
  formatDetection: {
    telephone: false, // stops iOS from auto-linking phone-looking numbers
  },
};

// Viewport must be a named export in Next 14+ (was previously mixed into
// Metadata). themeColor drives Chrome's chrome tint on Android and the
// PWA install shell — matches navy-900 on tailwind.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0f172a" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
  ],
  width: "device-width",
  initialScale: 1,
  // viewport-fit=cover lets us paint under iOS safe-areas when installed
  viewportFit: "cover",
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
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
