import { defineRouting } from "next-intl/routing";
import { createNavigation } from "next-intl/navigation";

// Locales supported across the platform. Add more here, then create
// matching `messages/<locale>.json`. See docs/MULTILINGUAL.md.
export const routing = defineRouting({
  locales: ["en", "th"],
  defaultLocale: "en",
  // English at root (`/services`), Thai at `/th/services`.
  // See docs/MULTILINGUAL.md § "URL strategy".
  localePrefix: "as-needed",
});

export type AppLocale = (typeof routing.locales)[number];

// `Link`, `redirect`, `usePathname`, `useRouter` from this module
// auto-prefix the locale. Frontend code MUST use these instead of
// the corresponding imports from `next/link` / `next/navigation`
// for any locale-aware navigation.
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
