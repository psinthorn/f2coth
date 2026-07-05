"use client";

// /admin/ai/usage — recent request log with filter + cost. This is the
// "did anything go wrong?" and "is our budget on track?" page. Landing
// page already shows aggregates; this one shows per-request detail.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Coins, Loader2, AlertTriangle, XCircle } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { adminApi, type AIUsageEntry } from "@/lib/admin-api";

export default function AdminAIUsagePage() {
  const t = useTranslations("admin.ai.usage");
  const tc = useTranslations("common");
  const [entries, setEntries] = useState<AIUsageEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [taskFilter, setTaskFilter] = useState("");

  async function load() {
    setLoading(true); setErr("");
    try {
      const d = await adminApi.listAIUsageEntries({
        limit: 200,
        task_type: taskFilter || undefined,
      });
      setEntries(d.entries ?? []);
    } catch (e: unknown) {
      setErr(tryMsg(e));
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [taskFilter]);

  // Distinct task types for the filter dropdown.
  const [allTasks, setAllTasks] = useState<string[]>([]);
  useEffect(() => {
    // On first load, capture the unique tasks in the full result.
    if (!taskFilter && entries.length > 0) {
      const tasks = Array.from(new Set(entries.map((e) => e.task_type))).sort();
      setAllTasks(tasks);
    }
  }, [entries, taskFilter]);

  return (
    <AdminShell>
      <header className="mb-6">
        <div className="flex items-center gap-2">
          <Coins className="h-6 w-6 text-accent-700" />
          <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
        </div>
        <p className="mt-1 text-sm text-navy-600">{t("subtitle")}</p>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="text-sm text-navy-700">{t("filterTask")}</label>
        <select
          value={taskFilter}
          onChange={(e) => setTaskFilter(e.target.value)}
          className="rounded-lg border border-navy-200 px-3 py-1.5 text-sm"
        >
          <option value="">{t("allTasks")}</option>
          {allTasks.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {err && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4" /><span>{err}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-navy-500">
          <Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}
        </div>
      ) : entries.length === 0 ? (
        <div className="card text-center text-navy-500">{t("noEntries")}</div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-navy-50 text-left text-xs uppercase text-navy-500">
              <tr>
                <th className="px-3 py-2">{t("time")}</th>
                <th className="px-3 py-2">{t("task")}</th>
                <th className="px-3 py-2">{t("provider")}</th>
                <th className="px-3 py-2">{t("model")}</th>
                <th className="px-3 py-2 text-right">{t("tokensIn")}</th>
                <th className="px-3 py-2 text-right">{t("tokensOut")}</th>
                <th className="px-3 py-2 text-right">{t("costUSD")}</th>
                <th className="px-3 py-2 text-right">{t("latencyMs")}</th>
                <th className="px-3 py-2">{t("status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {entries.map((e, i) => (
                <tr key={`${e.at}-${i}`} className="hover:bg-navy-50">
                  <td className="px-3 py-2 text-xs text-navy-500">{new Date(e.at).toLocaleString()}</td>
                  <td className="px-3 py-2 text-navy-800">{e.task_type}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${
                      e.provider === "ollama" ? "bg-emerald-100 text-emerald-800" : "bg-sky-100 text-sky-800"
                    }`}>{e.provider}</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-navy-700">{e.model}</td>
                  <td className="px-3 py-2 text-right text-navy-700">{e.tokens_in.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-navy-700">{e.tokens_out.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-navy-900">${e.cost_usd.toFixed(6)}</td>
                  <td className="px-3 py-2 text-right text-navy-500">{e.latency_ms}</td>
                  <td className="px-3 py-2">
                    {e.error ? (
                      <span className="inline-flex items-center gap-1 text-xs text-red-700" title={e.error}>
                        <XCircle className="h-3 w-3" /> {t("errored")}
                      </span>
                    ) : (
                      <span className="text-xs text-emerald-700">{t("ok")}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
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
