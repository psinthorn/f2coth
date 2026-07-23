"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Globe, LayoutDashboard, UserSquare2, Server, ShieldCheck, Search, Loader2, Lock, AlertCircle, History, X,
} from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { toast } from "@/lib/toast";
import { adminApi, type AdminModule, type ModuleArea, type ModuleAuditEntry } from "@/lib/admin-api";

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
  const tc = useTranslations("common");
  const locale = useLocale();
  const [modules, setModules] = useState<AdminModule[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [query, setQuery] = useState("");
  // Track which keys are currently being PATCHed so we can show a spinner and
  // disable the switch — prevents double-clicks racing the optimistic update.
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [rowError, setRowError] = useState<Record<string, string>>({});
  // History panel state — opens when a row's "History" button is clicked.
  const [auditKey, setAuditKey] = useState<string | null>(null);
  const [auditEntries, setAuditEntries] = useState<ModuleAuditEntry[] | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);

  async function openAudit(key: string) {
    setAuditKey(key);
    setAuditEntries(null);
    setAuditError(null);
    try {
      const rows = await adminApi.listModuleAudit(key);
      setAuditEntries(rows);
    } catch (e) {
      setAuditError((e as Error).message || "load failed");
    }
  }

  function closeAudit() {
    setAuditKey(null);
    setAuditEntries(null);
    setAuditError(null);
  }

  useEffect(() => {
    let cancelled = false;
    // AdminShell stashes the authenticated user in sessionStorage after the
    // /auth/me check completes. The PATCH endpoint is admin-only (editors
    // get 403), so deep-linking an editor here is a UX dead end — bail
    // early and show the forbidden screen instead.
    try {
      const cached = sessionStorage.getItem("f2_user");
      if (cached) {
        const user = JSON.parse(cached) as { role?: string };
        if (user.role !== "admin") {
          setForbidden(true);
          return;
        }
      }
    } catch {
      // sessionStorage unavailable — fall through and let AdminShell's own
      // auth flow handle it.
    }
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
    if (pending.has(m.key)) return; // ignore rapid re-toggle while the PATCH is in flight.
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
      toast.success(tc("toast.updated"));
    } catch (e) {
      // Revert the optimistic update.
      setModules((rows) =>
        rows ? rows.map((r) => (r.key === m.key ? { ...r, enabled: !next } : r)) : rows,
      );
      const msg = (e as Error).message || "error";
      setRowError((er) => ({ ...er, [m.key]: msg }));
      toast.error(msg);
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

  if (forbidden) {
    return (
      <AdminShell>
        <div className="mx-auto max-w-md rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
          <Lock className="mb-2 h-6 w-6" />
          <h2 className="font-semibold">{t("forbiddenTitle")}</h2>
          <p className="mt-1 text-sm">{t("forbiddenBody")}</p>
        </div>
      </AdminShell>
    );
  }

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
                        <th className="px-4 py-2 font-medium text-right">{t("col.history")}</th>
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
                          onAudit={openAudit}
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

      {auditKey && (
        <AuditPanel
          moduleKey={auditKey}
          entries={auditEntries}
          error={auditError}
          onClose={closeAudit}
          t={t}
        />
      )}
    </AdminShell>
  );
}

function AuditPanel({
  moduleKey,
  entries,
  error,
  onClose,
  t,
}: {
  moduleKey: string;
  entries: ModuleAuditEntry[] | null;
  error: string | null;
  onClose: () => void;
  t: (k: string) => string;
}) {
  return (
    <>
      <button
        aria-label={t("closeAudit")}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-navy-900/30 backdrop-blur-sm"
      />
      <aside
        role="dialog"
        aria-label={t("auditTitle")}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-navy-200 bg-white shadow-xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-navy-100 px-5 py-4">
          <div>
            <h3 className="font-display text-lg text-navy-900">{t("auditTitle")}</h3>
            <code className="mt-0.5 inline-block rounded bg-navy-100 px-1.5 py-0.5 font-mono text-xs text-navy-700">
              {moduleKey}
            </code>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-navy-500 hover:bg-navy-100 hover:text-navy-900"
            aria-label={t("closeAudit")}
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {error}
            </div>
          )}
          {!error && entries === null && (
            <div className="grid place-items-center py-12 text-navy-500">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}
          {entries && entries.length === 0 && (
            <p className="text-sm text-navy-500">{t("auditEmpty")}</p>
          )}
          {entries && entries.length > 0 && (
            <ol className="space-y-3">
              {entries.map((e, i) => (
                <li key={`${e.at}-${i}`} className="rounded-lg border border-navy-100 bg-navy-50/40 p-3">
                  <div className="flex items-center justify-between text-xs text-navy-500">
                    <span className="font-medium text-navy-700">{e.action}</span>
                    <time>{e.at}</time>
                  </div>
                  <div className="mt-1 text-xs text-navy-600">
                    {e.actor_email ?? t("systemActor")}
                  </div>
                  {Object.keys(e.changes).length > 0 && (
                    <pre className="mt-2 overflow-x-auto rounded bg-white p-2 text-xs text-navy-800 ring-1 ring-navy-100">
                      {JSON.stringify(e.changes, null, 2)}
                    </pre>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </aside>
    </>
  );
}

function ModuleRow({
  module: m,
  locale,
  pending,
  error,
  onToggle,
  onAudit,
  t,
}: {
  module: AdminModule;
  locale: string;
  pending: boolean;
  error?: string;
  onToggle: (m: AdminModule, next: boolean) => void;
  onAudit: (key: string) => void;
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
      <td className="px-4 py-2.5 text-right">
        <button
          type="button"
          onClick={() => onAudit(m.key)}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-navy-600 hover:bg-navy-100 hover:text-navy-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
          aria-label={t("openAuditFor")}
        >
          <History className="h-3.5 w-3.5" />
          {t("history")}
        </button>
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
