"use client";

// /admin/ai/routing — data-driven routing table admin. Every AI task
// (orchestrator, content_writer, ticket_triage, ...) has a primary and
// (usually) fallback route pointing at a provider + model. Edit here to
// change what serves what without a code deploy. Backend router polls
// this table every ~30s.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Route, Loader2, AlertTriangle, Save, Check } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { adminApi, type AIRoutingRow, type AIProvider } from "@/lib/admin-api";

const PROVIDERS: AIProvider[] = ["anthropic", "ollama", "openai", "voyage"];

export default function AdminAIRoutingPage() {
  const t = useTranslations("admin.ai.routing");
  const tc = useTranslations("common");
  const [rows, setRows] = useState<AIRoutingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  async function load() {
    setLoading(true); setErr("");
    try {
      const d = await adminApi.listAIRouting();
      setRows(d.routes ?? []);
    } catch (e: unknown) {
      setErr(tryMsg(e));
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function updateLocal(id: string, patch: Partial<AIRoutingRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function save(row: AIRoutingRow) {
    setSavingId(row.id); setErr("");
    try {
      await adminApi.updateAIRoute(row.id, {
        provider: row.provider,
        model: row.model,
        max_tokens_in: row.max_tokens_in,
        max_tokens_out: row.max_tokens_out,
        enabled: row.enabled,
      });
      setSavedId(row.id);
      setTimeout(() => setSavedId(null), 1500);
    } catch (e: unknown) {
      setErr(tryMsg(e));
    } finally { setSavingId(null); }
  }

  // Group by task_type so primary + fallback show side-by-side.
  const grouped = rows.reduce<Record<string, AIRoutingRow[]>>((acc, r) => {
    (acc[r.task_type] ??= []).push(r);
    return acc;
  }, {});

  return (
    <AdminShell>
      <header className="mb-6">
        <div className="flex items-center gap-2">
          <Route className="h-6 w-6 text-accent-700" />
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
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([task, tiers]) => (
            <section key={task} className="card">
              <h2 className="font-semibold text-navy-900">{task}</h2>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-navy-500">
                    <tr>
                      <th className="pb-2 pr-3">{t("tier")}</th>
                      <th className="pb-2 pr-3">{t("provider")}</th>
                      <th className="pb-2 pr-3">{t("model")}</th>
                      <th className="pb-2 pr-3">{t("maxOut")}</th>
                      <th className="pb-2 pr-3">{t("enabled")}</th>
                      <th className="pb-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-navy-100">
                    {tiers.map((r) => (
                      <tr key={r.id}>
                        <td className="py-2 pr-3">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${
                            r.tier === "primary" ? "bg-accent-100 text-accent-800" : "bg-navy-100 text-navy-700"
                          }`}>{r.tier}</span>
                        </td>
                        <td className="py-2 pr-3">
                          <select
                            value={r.provider}
                            onChange={(e) => updateLocal(r.id, { provider: e.target.value as AIProvider })}
                            className={`rounded-lg border px-2 py-1 text-sm ${
                              r.provider === "ollama" ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-sky-300 bg-sky-50 text-sky-900"
                            }`}
                          >
                            {PROVIDERS.map((p) => (
                              <option key={p} value={p}>{p}</option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2 pr-3">
                          <input
                            type="text"
                            value={r.model}
                            onChange={(e) => updateLocal(r.id, { model: e.target.value })}
                            className="w-64 rounded-lg border border-navy-200 px-2 py-1 text-sm font-mono"
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <input
                            type="number"
                            value={r.max_tokens_out ?? ""}
                            onChange={(e) => updateLocal(r.id, {
                              max_tokens_out: e.target.value === "" ? null : Number(e.target.value),
                            })}
                            className="w-20 rounded-lg border border-navy-200 px-2 py-1 text-sm"
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <input
                            type="checkbox"
                            checked={r.enabled}
                            onChange={(e) => updateLocal(r.id, { enabled: e.target.checked })}
                          />
                        </td>
                        <td className="py-2 text-right">
                          <button
                            onClick={() => save(r)}
                            disabled={savingId === r.id}
                            className="btn-accent text-xs"
                          >
                            {savingId === r.id
                              ? <><Loader2 className="h-3 w-3 animate-spin" /> {tc("saving")}</>
                              : savedId === r.id
                              ? <><Check className="h-3 w-3" /> {tc("saved")}</>
                              : <><Save className="h-3 w-3" /> {tc("save")}</>}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {tiers[0]?.notes && (
                <p className="mt-2 text-xs text-navy-500">{tiers[0].notes}</p>
              )}
            </section>
          ))}
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
