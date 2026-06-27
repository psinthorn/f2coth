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
}: { children: React.ReactNode; locale: string }) {
  const pathname = usePathname() ?? "";
  const isAppRoute =
    pathname === "/admin" || pathname.startsWith("/admin/") ||
    pathname === "/portal" || pathname.startsWith("/portal/");

  if (isAppRoute) {
    return <>{children}</>;
  }

  return (
    <>
      <Header />
      <main>{children}</main>
      <Footer />
      <ChatWidget />
      <CookieBanner locale={locale} />
    </>
  );
}
