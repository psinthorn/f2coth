"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Home, Check } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { toast } from "@/lib/toast";
import { adminApi, type AdminHomeContentItem } from "@/lib/admin-api";

interface Group {
  labelKey: string;
  keys: string[];
}

// Groupings mirror the visual sections of the pages they drive so editors see
// the copy in the same order it renders on the public site.
const GROUPS: Group[] = [
  {
    labelKey: "group.hero",
    keys: [
      "hero.badge",
      "hero.headline",
      "hero.subhead",
      "hero.ctaPrimary",
      "hero.ctaSecondary",
      "hero.trust.kohSamui",
      "hero.trust.sameDay",
      "hero.trust.partners",
    ],
  },
  {
    labelKey: "group.services",
    keys: ["services.kicker", "services.title", "services.all8"],
  },
  {
    labelKey: "group.trustedBy",
    keys: ["trustedBy.title"],
  },
  {
    labelKey: "group.cta",
    keys: ["cta.title", "cta.subtitle", "cta.button"],
  },
  {
    labelKey: "group.servicesPage",
    keys: ["services_page.kicker", "services_page.title", "services_page.subtitle"],
  },
  {
    labelKey: "group.caseStudiesPage",
    keys: ["case_studies_page.kicker", "case_studies_page.title", "case_studies_page.subtitle"],
  },
];

export default function AdminHomeContentPage() {
  const t = useTranslations("admin.homeContent");
  const tc = useTranslations("common");
  const [items, setItems] = useState<Record<string, AdminHomeContentItem>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    adminApi.listAdminHomeContent()
      .then((d) => {
        const map: Record<string, AdminHomeContentItem> = {};
        for (const it of d.items ?? []) map[it.key] = it;
        setItems(map);
      })
      .catch(() => setError(tc("errorLoad")))
      .finally(() => setLoading(false));
  }, [tc]);

  function setValue(key: string, lang: "en" | "th", value: string) {
    setSaved(false);
    setItems((prev) => {
      const existing = prev[key] ?? { key, value: { en: "", th: "" }, updated_at: "" };
      return {
        ...prev,
        [key]: { ...existing, value: { ...existing.value, [lang]: value } },
      };
    });
  }

  async function handleSaveAll() {
    if (saving) return; // re-entry guard: no double-submit while in flight
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      await adminApi.upsertHomeContent(Object.values(items));
      setSaved(true);
      toast.success(tc("toast.saved"));
    } catch (e: any) {
      const msg = e?.body ? JSON.parse(e.body)?.error ?? t("saveError") : t("saveError");
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <AdminShell>
        <div className="flex items-center gap-2 text-navy-500">
          <Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Home className="h-6 w-6 text-accent-700" />
            <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
          </div>
          <p className="mt-1 text-sm text-navy-600">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {saved && !saving && (
            <span className="flex items-center gap-1 text-sm text-emerald-700">
              <Check className="h-4 w-4" /> {tc("saved")}
            </span>
          )}
          <button
            onClick={handleSaveAll}
            disabled={saving}
            className="btn-accent disabled:opacity-60"
          >
            {saving ? (
              <>
                <Loader2 className="inline h-4 w-4 animate-spin mr-1" />
                {tc("saving")}
              </>
            ) : (
              tc("saveAll")
            )}
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-8">
        {GROUPS.map((g) => (
          <section key={g.labelKey}>
            <h2 className="font-display text-xl text-navy-900 mb-3">{t(g.labelKey as any)}</h2>
            <div className="space-y-4">
              {g.keys.map((k) => {
                const item = items[k] ?? { key: k, value: { en: "", th: "" }, updated_at: "" };
                const isLong = (item.value.en?.length ?? 0) > 80 || (item.value.th?.length ?? 0) > 80;
                return (
                  <div key={k} className="card">
                    <p className="mb-2 font-mono text-xs text-navy-500">{k}</p>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <label className="block text-xs font-medium text-navy-600 mb-1">EN</label>
                        {isLong ? (
                          <textarea
                            value={item.value.en ?? ""}
                            onChange={(e) => setValue(k, "en", e.target.value)}
                            rows={3}
                            className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
                          />
                        ) : (
                          <input
                            type="text"
                            value={item.value.en ?? ""}
                            onChange={(e) => setValue(k, "en", e.target.value)}
                            className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
                          />
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-navy-600 mb-1">TH</label>
                        {isLong ? (
                          <textarea
                            value={item.value.th ?? ""}
                            onChange={(e) => setValue(k, "th", e.target.value)}
                            rows={3}
                            className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
                          />
                        ) : (
                          <input
                            type="text"
                            value={item.value.th ?? ""}
                            onChange={(e) => setValue(k, "th", e.target.value)}
                            className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
                          />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </AdminShell>
  );
}
