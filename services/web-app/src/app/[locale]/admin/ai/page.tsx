"use client";

// /admin/ai — landing dashboard for the AI orchestrator pilot.
// Shows month-to-date spend, budget headroom, and links to the routing
// + usage sub-pages. This is the operator's home base for the pilot.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Bot, Coins, Route, Loader2, AlertTriangle, TrendingUp } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { adminApi, type AIUsageSummary } from "@/lib/admin-api";

export default function AdminAIHomePage() {
  const t = useTranslations("admin.ai.home");
  const tc = useTranslations("common");
  const [summary, setSummary] = useState<AIUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    adminApi.getAIUsageSummary()
      .then(setSummary)
      .catch((e: unknown) => setErr(tryMsg(e)))
      .finally(() => setLoading(false));
  }, []);

  const pctColor = summary && summary.pct_used >= 100
    ? "text-red-700"
    : summary && summary.pct_used >= 80
    ? "text-amber-700"
    : "text-emerald-700";

  return (
    <AdminShell>
      <header className="mb-6">
        <div className="flex items-center gap-2">
          <Bot className="h-6 w-6 text-accent-700" />
          <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
        </div>
        <p className="mt-1 text-sm text-navy-600">{t("subtitle")}</p>
      </header>

      {err && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4" /><span>{err}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-navy-500">
          <Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}
        </div>
      ) : summary ? (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <StatCard
              label={t("mtdSpend")}
              value={`$${summary.mtd_cost_usd.toFixed(2)}`}
              sub={`${summary.calls_mtd} ${t("calls")}`}
              icon={<Coins className="h-5 w-5" />}
            />
            <StatCard
              label={t("budget")}
              value={`$${summary.budget_usd.toFixed(2)}`}
              sub={<span className={pctColor}>{summary.pct_used.toFixed(1)}% {t("used")}</span>}
              icon={<TrendingUp className="h-5 w-5" />}
            />
            <StatCard
              label={t("todaySpend")}
              value={`$${summary.today_cost_usd.toFixed(2)}`}
              sub={t("today")}
              icon={<Coins className="h-5 w-5" />}
            />
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <section className="card">
              <h2 className="font-semibold text-navy-900">{t("byProvider")}</h2>
              {summary.by_provider.length === 0 ? (
                <p className="mt-3 text-sm text-navy-500">{t("noActivity")}</p>
              ) : (
                <table className="mt-3 w-full text-sm">
                  <thead className="text-left text-xs uppercase text-navy-500">
                    <tr><th className="pb-1">{t("provider")}</th><th className="pb-1 text-right">{t("calls")}</th><th className="pb-1 text-right">{t("cost")}</th></tr>
                  </thead>
                  <tbody className="divide-y divide-navy-100">
                    {summary.by_provider.map((p) => (
                      <tr key={p.provider}>
                        <td className="py-1.5 font-medium text-navy-900">
                          <ProviderBadge provider={p.provider} />
                        </td>
                        <td className="py-1.5 text-right text-navy-700">{p.calls}</td>
                        <td className="py-1.5 text-right text-navy-900">${p.cost_usd.toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="card">
              <h2 className="font-semibold text-navy-900">{t("byTask")}</h2>
              {summary.by_task.length === 0 ? (
                <p className="mt-3 text-sm text-navy-500">{t("noActivity")}</p>
              ) : (
                <table className="mt-3 w-full text-sm">
                  <thead className="text-left text-xs uppercase text-navy-500">
                    <tr><th className="pb-1">{t("task")}</th><th className="pb-1 text-right">{t("calls")}</th><th className="pb-1 text-right">{t("cost")}</th></tr>
                  </thead>
                  <tbody className="divide-y divide-navy-100">
                    {summary.by_task.map((tk) => (
                      <tr key={tk.task_type}>
                        <td className="py-1.5 text-navy-700">{tk.task_type}</td>
                        <td className="py-1.5 text-right text-navy-700">{tk.calls}</td>
                        <td className="py-1.5 text-right text-navy-900">${tk.cost_usd.toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Link href={"/admin/ai/routing" as never} className="card block hover:border-accent-500 transition">
              <div className="flex items-center gap-2 text-navy-900">
                <Route className="h-5 w-5 text-accent-700" />
                <h3 className="font-semibold">{t("goRouting")}</h3>
              </div>
              <p className="mt-2 text-sm text-navy-600">{t("goRoutingBody")}</p>
            </Link>
            <Link href={"/admin/ai/usage" as never} className="card block hover:border-accent-500 transition">
              <div className="flex items-center gap-2 text-navy-900">
                <Coins className="h-5 w-5 text-accent-700" />
                <h3 className="font-semibold">{t("goUsage")}</h3>
              </div>
              <p className="mt-2 text-sm text-navy-600">{t("goUsageBody")}</p>
            </Link>
          </div>
        </>
      ) : null}
    </AdminShell>
  );
}

function StatCard({ label, value, sub, icon }: {
  label: string; value: string; sub: React.ReactNode; icon: React.ReactNode;
}) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 text-navy-500">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p className="mt-3 font-display text-3xl text-navy-900">{value}</p>
      <p className="mt-1 text-xs text-navy-500">{sub}</p>
    </div>
  );
}

function ProviderBadge({ provider }: { provider: string }) {
  const isLocal = provider === "ollama";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
      isLocal ? "bg-emerald-100 text-emerald-800" : "bg-sky-100 text-sky-800"
    }`}>
      {provider}
    </span>
  );
}

function tryMsg(e: unknown): string {
  if (!e) return "error";
  const anyE = e as { body?: string; message?: string };
  if (anyE.body) {
    try { return (JSON.parse(anyE.body) as { error?: string }).error ?? anyE.body; } catch { return anyE.body; }
  }
  return anyE.message ?? "error";
}
