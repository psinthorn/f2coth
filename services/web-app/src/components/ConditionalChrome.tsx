"use client";

import { usePathname } from "next/navigation";
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
  // Use next/navigation's usePathname (returns the raw URL path, always
  // including the locale prefix on SSR) rather than next-intl's, which
  // stripped-locale behavior is inconsistent between SSR and CSR — that
  // caused the public Footer to leak into admin pages on the server render.
  const pathname = usePathname() ?? "";
  const isAppRoute = /^\/(?:[a-z]{2}\/)?(admin|portal)(?:\/|$)/.test(pathname);

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
