"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, PauseCircle, PlayCircle, X, CheckCircle2 } from "lucide-react";
import { Link } from "@/i18n/routing";
import AdminShell from "@/components/AdminShell";
import { adminApi, type AdminSuspension } from "@/lib/admin-api";

const STATUSES = ["active", "restored", "overridden", ""] as const;

export default function AdminSuspensionsPage() {
  const t = useTranslations("admin.suspensions");
  const tc = useTranslations("common");
  const [rows, setRows] = useState<AdminSuspension[] | null>(null);
  const [status, setStatus] = useState<string>("active");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function reload() {
    setRows(null);
    adminApi.listSuspensions(status ? { status } : undefined).then(setRows).catch(() => setRows([]));
  }
  useEffect(reload, [status]);

  async function restore(id: string) {
    setBusy(id); setMsg(null);
    try {
      await adminApi.restoreSuspension(id);
      setMsg(t("restored"));
      reload();
    } catch (e: unknown) {
      const v = e as { body?: string };
      setMsg(v.body || tc("error"));
    } finally { setBusy(null); }
  }
  async function override(id: string) {
    const reason = window.prompt(t("overridePrompt")) ?? "";
    if (!reason) return;
    setBusy(id); setMsg(null);
    try {
      await adminApi.overrideSuspension(id, reason);
      setMsg(t("overridden"));
      reload();
    } catch (e: unknown) {
      const v = e as { body?: string };
      setMsg(v.body || tc("error"));
    } finally { setBusy(null); }
  }

  return (
    <AdminShell>
      <header className="mb-6">
        <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-navy-600">{t("subtitle")}</p>
      </header>

      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        {STATUSES.map((s) => (
          <button
            key={s || "all"}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded-full border px-3 py-1 ${
              status === s ? "border-accent-500 bg-accent-50 text-accent-900" : "border-navy-200 text-navy-600 hover:bg-navy-50"
            }`}
          >
            {s ? t(`status.${s}`) : t("all")}
          </button>
        ))}
      </div>

      {msg && <p className="mb-3 text-sm text-emerald-700">{msg}</p>}

      {rows === null ? (
        <div className="text-navy-500"><Loader2 className="inline h-4 w-4 animate-spin" /> {tc("loading")}</div>
      ) : rows.length === 0 ? (
        <div className="card text-center text-navy-500">{t("empty")}</div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-navy-50 text-left text-xs uppercase tracking-wider text-navy-500">
              <tr>
                <th className="px-4 py-3 font-semibold">{t("col.suspendedAt")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.customer")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.invoice")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.product")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.previousState")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.status")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 text-xs text-navy-600 whitespace-nowrap">
                    {new Date(r.suspended_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-navy-700">{r.customer_name}</td>
                  <td className="px-4 py-3">
                    <Link href={{ pathname: "/admin/invoices/[id]", params: { id: r.invoice_id } } as never}
                      className="text-accent-700 hover:underline">
                      {r.invoice_number}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-xs uppercase text-navy-600">{r.product_type}</td>
                  <td className="px-4 py-3 text-xs text-navy-500">{r.previous_state ?? "—"}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={r.status} t={t} />
                  </td>
                  <td className="px-4 py-3 space-x-1 whitespace-nowrap">
                    {r.status === "active" && (
                      <>
                        <button type="button" disabled={busy === r.id} onClick={() => restore(r.id)}
                          className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-100">
                          <PlayCircle className="h-3 w-3" /> {t("restore")}
                        </button>
                        <button type="button" disabled={busy === r.id} onClick={() => override(r.id)}
                          className="inline-flex items-center gap-1 rounded-md bg-navy-100 px-2 py-1 text-xs text-navy-700 hover:bg-navy-200">
                          <X className="h-3 w-3" /> {t("override")}
                        </button>
                      </>
                    )}
                    {r.status !== "active" && r.restored_at && (
                      <span className="text-[10px] text-navy-500">
                        {new Date(r.restored_at).toLocaleDateString()}
                      </span>
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

function StatusPill({ status, t }: { status: string; t: ReturnType<typeof useTranslations> }) {
  const Icon = status === "active" ? PauseCircle : CheckCircle2;
  const cls = status === "active" ? "bg-amber-50 text-amber-900"
    : status === "restored" ? "bg-emerald-50 text-emerald-800"
    : "bg-navy-100 text-navy-700";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${cls}`}>
      <Icon className="h-3 w-3" /> {t(`status.${status}`)}
    </span>
  );
}
