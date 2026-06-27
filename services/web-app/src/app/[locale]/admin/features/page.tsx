"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Globe, LayoutDashboard, UserSquare2, Server, ShieldCheck, Search, Loader2, Lock, AlertCircle,
} from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { adminApi, type AdminModule, type ModuleArea } from "@/lib/admin-api";

const AREA_ORDER: ModuleArea[] = ["public", "portal", "admin", "api"];
const AREA_ICON: Record<ModuleArea, typeof Globe> = {
  public: Globe,
  portal: UserSquare2,
  admin: LayoutDashboard,
  api: Server,
};
const AREA_I18N_KEY: Record<ModuleArea, string> = {
  public: "publicSite",
  portal: "customerPortal",
  admin: "adminConsole",
  api: "api",
};

export default function AdminFeaturesPage() {
  const t = useTranslations("admin.features");
  const locale = useLocale();
  const [modules, setModules] = useState<AdminModule[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Track which keys are currently being PATCHed so we can show a spinner and
  // disable the switch — prevents double-clicks racing the optimistic update.
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [rowError, setRowError] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    adminApi
      .listModules()
      .then((rows) => {
        if (!cancelled) setModules(rows);
      })
      .catch((e: Error) => {
        if (!cancelled) setLoadError(e.message || "load failed");
      });
    return () => { cancelled = true; };
  }, []);

  async function onToggle(m: AdminModule, next: boolean) {
    if (m.core) return; // UI never shows a switch on core rows, but guard anyway.
    setPending((p) => new Set(p).add(m.key));
    setRowError((e) => { const { [m.key]: _, ...rest } = e; return rest; });
    // Optimistic update — flip the row immediately so the UI feels instant.
    setModules((rows) =>
      rows ? rows.map((r) => (r.key === m.key ? { ...r, enabled: next } : r)) : rows,
    );
    try {
      const updated = await adminApi.toggleModule(m.key, next);
      setModules((rows) =>
        rows ? rows.map((r) => (r.key === m.key ? updated : r)) : rows,
      );
    } catch (e) {
      // Revert the optimistic update.
      setModules((rows) =>
        rows ? rows.map((r) => (r.key === m.key ? { ...r, enabled: !next } : r)) : rows,
      );
      setRowError((er) => ({ ...er, [m.key]: (e as Error).message || "error" }));
    } finally {
      setPending((p) => { const n = new Set(p); n.delete(m.key); return n; });
    }
  }

  const groups = useMemo(() => {
    if (!modules) return [];
    const q = query.trim().toLowerCase();
    const byArea = new Map<ModuleArea, AdminModule[]>();
    for (const m of modules) {
      if (q) {
        const haystack = `${m.key} ${m.name_en} ${m.name_th} ${m.description ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) continue;
      }
      const list = byArea.get(m.area) ?? [];
      list.push(m);
      byArea.set(m.area, list);
    }
    return AREA_ORDER
      .filter((a) => (byArea.get(a)?.length ?? 0) > 0)
      .map((a) => ({ area: a, items: byArea.get(a)! }));
  }, [modules, query]);

  const totalEnabled = modules?.filter((m) => m.enabled).length ?? 0;
  const totalDisabled = modules ? modules.length - totalEnabled : 0;

  if (loadError) {
    return (
      <AdminShell>
        <div className="mx-auto max-w-md rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">
          <AlertCircle className="mb-2 h-6 w-6" />
          <h2 className="font-semibold">{t("loadErrorTitle")}</h2>
          <p className="mt-1 text-sm">{loadError}</p>
        </div>
      </AdminShell>
    );
  }

  if (!modules) {
    return (
      <AdminShell>
        <div className="grid place-items-center py-24 text-navy-500">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <header className="mb-8">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-accent-600" />
          <h1 className="font-display text-2xl text-navy-900">{t("title")}</h1>
        </div>
        <p className="mt-1 text-sm text-navy-600">
          {t("leadLive", { enabled: totalEnabled, disabled: totalDisabled })}
        </p>
      </header>

      {/* Filter bar */}
      <div className="mb-6 max-w-md">
        <label htmlFor="feature-search" className="sr-only">{t("searchLabel")}</label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-navy-400" />
          <input
            id="feature-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="w-full rounded-lg border border-navy-200 bg-white py-2 pl-9 pr-3 text-sm text-navy-900 placeholder:text-navy-400 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100"
          />
        </div>
      </div>

      {/* Summary chips */}
      <div className="mb-6 flex flex-wrap gap-2">
        {AREA_ORDER.map((area) => {
          const count = modules.filter((m) => m.area === area).length;
          if (count === 0) return null;
          const Icon = AREA_ICON[area];
          return (
            <span
              key={area}
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs text-navy-700 ring-1 ring-navy-200"
            >
              <Icon className="h-3.5 w-3.5 text-navy-500" />
              {t(`areas.${AREA_I18N_KEY[area]}`)}
              <span className="font-semibold text-navy-900">{count}</span>
            </span>
          );
        })}
      </div>

      <div className="space-y-8">
        {groups.length === 0 ? (
          <div className="rounded-xl border border-dashed border-navy-200 bg-white p-12 text-center text-navy-500">
            {t("emptyState")}
          </div>
        ) : (
          groups.map((g) => {
            const Icon = AREA_ICON[g.area];
            return (
              <section key={g.area}>
                <h2 className="mb-3 flex items-center gap-2 font-display text-lg text-navy-900">
                  <Icon className="h-5 w-5 text-navy-500" />
                  {t(`areas.${AREA_I18N_KEY[g.area]}`)}
                  <span className="text-sm font-normal text-navy-400">({g.items.length})</span>
                </h2>
                <div className="overflow-hidden rounded-xl border border-navy-100 bg-white">
                  <table className="w-full text-sm">
                    <thead className="bg-navy-50 text-left text-xs uppercase tracking-wider text-navy-500">
                      <tr>
                        <th className="px-4 py-2 font-medium">{t("col.feature")}</th>
                        <th className="px-4 py-2 font-medium">{t("col.key")}</th>
                        <th className="px-4 py-2 font-medium">{t("col.status")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-navy-100">
                      {g.items.map((m) => (
                        <ModuleRow
                          key={m.key}
                          module={m}
                          locale={locale}
                          pending={pending.has(m.key)}
                          error={rowError[m.key]}
                          onToggle={onToggle}
                          t={t}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })
        )}
      </div>
    </AdminShell>
  );
}

function ModuleRow({
  module: m,
  locale,
  pending,
  error,
  onToggle,
  t,
}: {
  module: AdminModule;
  locale: string;
  pending: boolean;
  error?: string;
  onToggle: (m: AdminModule, next: boolean) => void;
  t: (key: string) => string;
}) {
  const name = locale === "th" ? m.name_th : m.name_en;
  return (
    <tr className="text-navy-800 hover:bg-navy-50/50">
      <td className="px-4 py-2.5">
        <div className="font-medium">{name}</div>
        {m.description && <div className="text-xs text-navy-500">{m.description}</div>}
        {error && (
          <div className="mt-1 inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700">
            <AlertCircle className="h-3 w-3" /> {error}
          </div>
        )}
      </td>
      <td className="px-4 py-2.5">
        <code className="rounded bg-navy-100 px-2 py-0.5 font-mono text-xs text-navy-700">{m.key}</code>
      </td>
      <td className="px-4 py-2.5">
        {m.core ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-navy-100 px-2 py-0.5 text-xs text-navy-700 ring-1 ring-navy-200">
            <Lock className="h-3 w-3" /> {t("status.core")}
          </span>
        ) : (
          <Toggle enabled={m.enabled} pending={pending} onChange={(next) => onToggle(m, next)} />
        )}
      </td>
    </tr>
  );
}

function Toggle({
  enabled,
  pending,
  onChange,
}: { enabled: boolean; pending: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={pending}
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:cursor-not-allowed disabled:opacity-60 ${
        enabled ? "bg-emerald-500" : "bg-navy-200"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition ${
          enabled ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
      {pending && (
        <Loader2 className="absolute inset-0 m-auto h-3 w-3 animate-spin text-white" />
      )}
    </button>
  );
}
