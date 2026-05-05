import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import "./globals.css";

// The root layout is intentionally minimal: it owns the <html> + <body>
// shell only. Locale-aware chrome (Header / Footer / ChatWidget) lives
// in app/[locale]/layout.tsx; admin and portal have their own shells.
//
// We still need <html lang> here, so we resolve the active locale via
// next-intl's request-scoped helper. For non-localised paths (admin,
// portal) it falls back to the default locale ("en"), which is correct.

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://f2.co.th"),
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body className="min-h-screen bg-white text-navy-900 antialiased">
        {children}
      </body>
    </html>
  );
}
