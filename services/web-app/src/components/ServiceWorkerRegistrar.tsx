"use client";

// Registers /sw.js so the browser can serve marketing pages offline,
// prompt the user to install the PWA, and cache static assets. Runs
// once on mount, only in production builds (dev + HMR are fussy about
// SWs so we skip there). Also handles a soft-reload prompt when a new
// version of the SW takes control mid-session.

import { useEffect } from "react";

export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;
    // Delay registration a tick so it doesn't compete with above-the-fold
    // hydration. First paint stays snappy; SW picks up right after.
    const t = window.setTimeout(() => {
      if (cancelled) return;
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((registration) => {
          // If a new SW is installing, tell it to activate immediately
          // once install completes. Prevents users from being stuck on
          // an older shell for the rest of the session.
          registration.addEventListener("updatefound", () => {
            const installing = registration.installing;
            if (!installing) return;
            installing.addEventListener("statechange", () => {
              if (installing.state === "installed" && navigator.serviceWorker.controller) {
                installing.postMessage("SKIP_WAITING");
              }
            });
          });
        })
        .catch(() => {
          // Registration errors are non-fatal — the app still works
          // fully online without the SW.
        });
    }, 800);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, []);

  return null;
}
