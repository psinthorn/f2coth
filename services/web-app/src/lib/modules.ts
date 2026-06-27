// Server-side helper for the module-toggle architecture.
//
// Pages call `isModuleEnabled('public.blog')` at render time; disabled modules
// `notFound()` to keep them hidden from public/customer view.
//
// `getEnabledModules()` is per-request memoized via React.cache so a single
// render pass only hits cms-api once even if many components ask. Cache
// invalidation is implicit at request boundary — the admin toggle takes
// effect on the next request after PATCH completes.
//
// Fail mode: open. If cms-api is unreachable we return an empty map AND treat
// every key as enabled — better to flash existing content than to blank the
// whole site during a brief CMS restart. Toggle integrity is enforced at the
// API layer (Phase 7), not here.

import { cache } from "react";
import { apiBase } from "./api";

type ModuleRow = { key: string; enabled: boolean };

export type ModuleKey =
  | `public.${string}`
  | `portal.${string}`
  | `admin.${string}`
  | `api.${string}`;

// Internal state shape so callers can tell "fetched and all-enabled" from
// "fetch failed, fail-open default".
type ModulesSnapshot = {
  map: Map<string, boolean>;
  failedFetch: boolean;
};

export const getEnabledModules = cache(async (): Promise<ModulesSnapshot> => {
  try {
    const res = await fetch(`${apiBase.serverCMS}/modules`, {
      // Per-request cache only — Next's fetch dedup happens automatically;
      // we explicitly disable Next's stale time so toggles are visible on
      // the very next request.
      cache: "no-store",
    });
    if (!res.ok) {
      return { map: new Map(), failedFetch: true };
    }
    const rows = (await res.json()) as ModuleRow[];
    return {
      map: new Map(rows.map((r) => [r.key, r.enabled])),
      failedFetch: false,
    };
  } catch {
    return { map: new Map(), failedFetch: true };
  }
});

/**
 * isModuleEnabled — call from a server component's page.tsx, e.g.:
 *
 *   import { notFound } from "next/navigation";
 *   if (!(await isModuleEnabled("public.blog"))) notFound();
 *
 * Fail-open: returns true if the cms-api call failed OR the key is unknown.
 * Returns the live enabled flag otherwise.
 */
export async function isModuleEnabled(key: ModuleKey): Promise<boolean> {
  const snap = await getEnabledModules();
  if (snap.failedFetch) return true;
  // Unknown key → assume enabled (e.g. a new page added before the modules
  // row was seeded). Avoids surprise 404s during development.
  if (!snap.map.has(key)) return true;
  return snap.map.get(key) === true;
}

/**
 * getEnabledModulesRecord — server-side helper that returns the enabled map
 * as a plain Record<string, boolean> so it can be serialized and passed as a
 * prop into client components (Header / Footer). Maps don't survive RSC
 * serialization but plain objects do. Same fail-open behaviour as the rest of
 * this module — returns an empty object so consumers should treat "missing
 * key" as "assume enabled".
 */
export async function getEnabledModulesRecord(): Promise<Record<string, boolean>> {
  const snap = await getEnabledModules();
  if (snap.failedFetch) return {};
  return Object.fromEntries(snap.map);
}

/**
 * isEnabledIn — client-friendly equivalent of isModuleEnabled, operating on
 * the Record passed down as a prop. Same fail-open semantics: unknown key
 * (e.g. fetch failed and the record is empty) is treated as enabled.
 */
export function isEnabledIn(record: Record<string, boolean>, key: string): boolean {
  if (Object.keys(record).length === 0) return true;
  if (!(key in record)) return true;
  return record[key] === true;
}
