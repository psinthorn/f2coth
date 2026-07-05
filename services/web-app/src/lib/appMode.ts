// Server-side helper for the global app-mode indicator.
//
// One row in `app_config` drives banner + maintenance behaviour across
// public, portal, and admin. React.cache dedups the fetch to cms-api so
// a single render pass only hits it once even if multiple components ask.
//
// Fail mode: fall back to production with no message — better to render
// the site normally than to blank it during a brief cms-api hiccup.

import { cache } from "react";
import { apiBase } from "./api";

export type AppMode = "production" | "trial" | "maintenance";

export interface AppModeSnapshot {
  mode: AppMode;
  message: string;
}

export const getAppMode = cache(async (locale?: string): Promise<AppModeSnapshot> => {
  try {
    const url = `${apiBase.serverCMS}/app-mode${locale ? `?_loc=${encodeURIComponent(locale)}` : ""}`;
    const res = await fetch(url, {
      cache: "no-store",
      headers: locale ? { "Accept-Language": locale } : undefined,
    });
    if (!res.ok) return { mode: "production", message: "" };
    const data = (await res.json()) as AppModeSnapshot;
    return {
      mode: data.mode ?? "production",
      message: data.message ?? "",
    };
  } catch {
    return { mode: "production", message: "" };
  }
});
