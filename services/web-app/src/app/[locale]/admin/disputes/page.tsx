"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, AlertTriangle, CheckCircle2, XCircle, Clock } from "lucide-react";
import { Link } from "@/i18n/routing";
import AdminShell from "@/components/AdminShell";
import { adminApi, type AdminDispute } from "@/lib/admin-api";
import { formatMoney } from "@/lib/payment-types";

const STATUSES = ["", "open", "waiting_buyer", "waiting_seller", "under_review", "resolved", "closed"] as const;

export default function AdminDisputesPage() {
  const t = useTranslations("admin.disputes");
  const tc = useTranslations("common");
  const [rows, setRows] = useState<AdminDispute[] | null>(null);
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    setRows(null);
    adminApi.listDisputes(status ? { status } : undefined).then(setRows).catch(() => setRows([]));
  }, [status]);

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

      {rows === null ? (
        <div className="text-navy-500"><Loader2 className="inline h-4 w-4 animate-spin" /> {tc("loading")}</div>
      ) : rows.length === 0 ? (
        <div className="card text-center text-navy-500">{t("empty")}</div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-navy-50 text-left text-xs uppercase tracking-wider text-navy-500">
              <tr>
                <th className="px-4 py-3 font-semibold">{t("col.disputeID")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.invoice")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.customer")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.reason")}</th>
                <th className="px-4 py-3 font-semibold text-right">{t("col.amount")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.opened")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.due")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {rows.map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-3 font-mono text-xs">{d.provider_dispute_id}</td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/invoices/${d.invoice_id}`}
                      className="text-accent-700 hover:underline">
                      {d.invoice_number}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-navy-700">{d.customer_name}</td>
                  <td className="px-4 py-3 text-xs text-navy-600">{d.reason ?? "—"}</td>
                  <td className="px-4 py-3 text-right">{formatMoney(d.amount_cents, d.currency)}</td>
                  <td className="px-4 py-3 text-xs text-navy-500">{new Date(d.opened_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-xs">
                    {d.seller_response_due ? (
                      <DueChip due={d.seller_response_due} />
                    ) : <span className="text-navy-400">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={d.status} outcome={d.outcome} t={t} />
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

function DueChip({ due }: { due: string }) {
  const diff = (new Date(due).getTime() - Date.now()) / (24 * 3600 * 1000);
  const cls = diff < 1 ? "bg-red-50 text-red-800" : diff < 3 ? "bg-amber-50 text-amber-900" : "bg-navy-50 text-navy-700";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${cls}`}>
      <Clock className="h-3 w-3" /> {new Date(due).toLocaleDateString()}
    </span>
  );
}

function StatusPill({
  status, outcome, t,
}: {
  status: string;
  outcome: string | null;
  t: ReturnType<typeof useTranslations>;
}) {
  const Icon = status === "open" || status === "waiting_seller" ? AlertTriangle
    : status === "resolved" || status === "closed" ? (outcome?.includes("SELLER") ? CheckCircle2 : XCircle)
    : Clock;
  const cls = status === "open" || status === "waiting_seller" ? "bg-red-50 text-red-800"
    : status === "resolved" ? (outcome?.includes("SELLER") ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900")
    : status === "closed" ? "bg-navy-100 text-navy-700"
    : "bg-blue-50 text-blue-800";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${cls}`}>
      <Icon className="h-3 w-3" />
      {t(`status.${status}`)}
      {outcome && <span className="ml-1 text-[10px] opacity-70">({outcome})</span>}
    </span>
  );
}
