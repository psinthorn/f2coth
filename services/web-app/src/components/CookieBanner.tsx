"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";

// CookieBanner — shown on first visit; hides once consent is recorded.
// Stores choice in localStorage (key: f2_cookie_consent) and POSTs to
// /api/consent so F2 has an auditable PDPA consent record.
//
// Consent model:
//   essential  → always on (no consent needed — strictly necessary)
//   analytics  → off by default; opt-in
//   marketing  → off by default; opt-in
//
// Design: bottom bar, non-blocking, mobile-first. Does NOT use a modal
// so the visitor can still scroll and read content before deciding.

const CONSENT_KEY = "f2_cookie_consent";
const VISITOR_KEY  = "f2_visitor_id";

function getVisitorId(): string {
  let id = localStorage.getItem(VISITOR_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(VISITOR_KEY, id);
  }
  return id;
}

type ConsentState = {
  analytics: boolean;
  marketing: boolean;
  decided: boolean;
};

export default function CookieBanner({ locale }: { locale: string }) {
  const t = useTranslations("cookieBanner");
  const [show, setShow] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(CONSENT_KEY);
      if (stored) return; // already decided locally — no need to fetch

      // Not in localStorage: check server (covers returning visitors on new devices).
      const visitorId = localStorage.getItem(VISITOR_KEY);
      if (!visitorId) {
        // Brand-new visitor — no record anywhere; show the banner.
        setShow(true);
        return;
      }
      fetch(`/api/consent/${encodeURIComponent(visitorId)}`)
        .then(async (res) => {
          if (!res.ok) {
            setShow(true);
            return;
          }
          const data = (await res.json()) as {
            status: "active" | "withdrawn" | "none";
            analytics?: boolean;
            marketing?: boolean;
          };
          if (data.status === "active") {
            // Server has a live consent record: restore it locally so the
            // banner stays hidden.
            const payload: ConsentState = {
              analytics: !!data.analytics,
              marketing: !!data.marketing,
              decided: true,
            };
            localStorage.setItem(CONSENT_KEY, JSON.stringify(payload));
            setShow(false);
          } else {
            // "none" (first visit) or "withdrawn" (explicitly opted out earlier):
            // either way the visitor needs to make a fresh choice.
            setShow(true);
          }
        })
        .catch(() => {
          // Network error — err on the side of showing the banner.
          setShow(true);
        });
    } catch {
      // localStorage unavailable (SSR or private mode) — don't show banner
    }
  }, []);

  async function saveConsent(a: boolean, m: boolean) {
    const visitorId = getVisitorId();
    const payload: ConsentState = { analytics: a, marketing: m, decided: true };
    localStorage.setItem(CONSENT_KEY, JSON.stringify(payload));
    setShow(false);

    // Fire-and-forget POST to /api/consent — failure doesn't block the UX
    try {
      await fetch("/api/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visitor_id: visitorId,
          analytics: a,
          marketing: m,
          locale,
        }),
      });
    } catch {
      // Non-critical — consent is already stored locally
    }
  }

  if (!show) return null;

  return (
    <div
      role="dialog"
      aria-label={t("ariaLabel")}
      aria-live="polite"
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-200 bg-white shadow-lg"
    >
      <div className="container-page py-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          {/* Copy */}
          <div className="flex-1 text-sm text-slate-700">
            <p>
              {t("intro")}{" "}
              <Link href="/privacy" className="underline text-accent-600 hover:text-accent-700">
                {t("privacyLink")}
              </Link>
              .
            </p>

            {/* Expandable granular controls */}
            {expanded && (
              <div className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <label className="flex items-center gap-2 cursor-not-allowed opacity-60">
                  <input type="checkbox" checked disabled className="h-4 w-4" />
                  <span className="font-medium">{t("essential")}</span>
                  <span className="text-xs text-slate-500">({t("alwaysOn")})</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={analytics}
                    onChange={(e) => setAnalytics(e.target.checked)}
                    className="h-4 w-4 accent-accent-600"
                  />
                  <span className="font-medium">{t("analytics")}</span>
                  <span className="text-xs text-slate-500">— {t("analyticsDesc")}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={marketing}
                    onChange={(e) => setMarketing(e.target.checked)}
                    className="h-4 w-4 accent-accent-600"
                  />
                  <span className="font-medium">{t("marketing")}</span>
                  <span className="text-xs text-slate-500">— {t("marketingDesc")}</span>
                </label>
              </div>
            )}
          </div>

          {/* Buttons */}
          <div className="flex flex-wrap gap-2 sm:flex-nowrap sm:flex-col sm:items-end lg:flex-row">
            <button
              onClick={() => saveConsent(true, true)}
              className="btn-accent text-sm px-4 py-2"
            >
              {t("acceptAll")}
            </button>
            {!expanded ? (
              <button
                onClick={() => setExpanded(true)}
                className="btn-ghost text-sm px-4 py-2"
              >
                {t("manage")}
              </button>
            ) : (
              <button
                onClick={() => saveConsent(analytics, marketing)}
                className="btn-primary text-sm px-4 py-2"
              >
                {t("savePreferences")}
              </button>
            )}
            <button
              onClick={() => saveConsent(false, false)}
              className="btn-ghost text-sm px-4 py-2 text-slate-500"
            >
              {t("essentialOnly")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
