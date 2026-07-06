// Offline fallback served by the service worker when a navigation
// request fails and no cached copy exists. Kept intentionally minimal —
// no i18n dependency, no data fetch, no external image. Everything is
// inline so it renders even without network.

import type { Metadata } from "next";
import F2LogoMark from "@/components/F2LogoMark";

export const metadata: Metadata = {
  title: "Offline · F2",
  description: "You're offline. F2 will reconnect when you're back online.",
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    <main className="min-h-[70vh] flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-navy-900 text-white">
          <F2LogoMark className="h-8 w-8" />
        </div>
        <h1 className="font-display text-3xl text-navy-900">You&apos;re offline</h1>
        <p className="mt-3 text-navy-600">
          F2 will pick up where you left off as soon as your connection is back.
          Recently-visited marketing pages may still open from cache.
        </p>
        <a
          href="/"
          className="mt-6 inline-block rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800"
        >
          Try home page
        </a>
      </div>
    </main>
  );
}
