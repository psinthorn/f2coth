"use client";

import { usePathname } from "@/i18n/routing";
import Header from "./Header";
import Footer from "./Footer";
import ChatWidget from "./ChatWidget";
import CookieBanner from "./CookieBanner";

// Renders the public site chrome (Header / Footer / ChatWidget) on marketing
// routes, but NOT on /admin/* or /portal/*. Those areas have their own shells
// with sidebars + identity blocks; layering the public navbar on top would
// duplicate navigation and show wrong-state controls (e.g. "Customer login"
// to an already-signed-in customer).
export default function ConditionalChrome({
  children,
  locale,
  enabledModules,
}: {
  children: React.ReactNode;
  locale: string;
  // Plain object (not Map) so it serializes from the server component layout
  // into this client component. Empty object = fetch failed → render all
  // items (fail-open). See lib/modules.ts isEnabledIn().
  enabledModules: Record<string, boolean>;
}) {
  const pathname = usePathname() ?? "";
  const isAppRoute =
    pathname === "/admin" || pathname.startsWith("/admin/") ||
    pathname === "/portal" || pathname.startsWith("/portal/");

  if (isAppRoute) {
    return <>{children}</>;
  }

  return (
    <>
      <Header enabledModules={enabledModules} />
      <main>{children}</main>
      <Footer enabledModules={enabledModules} />
      <ChatWidget />
      <CookieBanner locale={locale} />
    </>
  );
}
