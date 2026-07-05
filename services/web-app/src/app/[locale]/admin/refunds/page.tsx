"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, RotateCcw, CheckCircle2 } from "lucide-react";
import { Link } from "@/i18n/routing";
import AdminShell from "@/components/AdminShell";
import { adminApi, type AdminRefund } from "@/lib/admin-api";
import { formatMoney } from "@/lib/payment-types";

const STATUSES = ["", "pending", "completed", "failed"] as const;

export default function AdminRefundsPage() {
  const t = useTranslations("admin.refunds");
  const tc = useTranslations("common");
  const [rows, setRows] = useState<AdminRefund[] | null>(null);
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    setRows(null);
    adminApi.listRefunds(status ? { status } : undefined).then(setRows).catch(() => setRows([]));
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
                <th className="px-4 py-3 font-semibold">{t("col.refund")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.invoice")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.customer")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.method")}</th>
                <th className="px-4 py-3 font-semibold text-right">{t("col.amount")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.reason")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 font-mono text-xs">
                    <span className="inline-flex items-center gap-1">
                      <RotateCcw className="h-3 w-3 text-navy-400" /> {r.refund_number}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={{ pathname: "/admin/invoices/[id]", params: { id: r.invoice_id } } as never}
                      className="text-accent-700 hover:underline">
                      {r.invoice_number}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{r.customer_name}</td>
                  <td className="px-4 py-3 text-xs uppercase text-navy-600">{r.method}</td>
                  <td className="px-4 py-3 text-right">{formatMoney(r.amount_cents, r.currency)}</td>
                  <td className="px-4 py-3 text-xs text-navy-700 max-w-xs truncate" title={r.reason}>{r.reason}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${
                      r.status === "completed" ? "bg-emerald-50 text-emerald-800"
                      : r.status === "failed" ? "bg-red-50 text-red-800"
                      : "bg-amber-50 text-amber-800"
                    }`}>
                      {r.status === "completed" && <CheckCircle2 className="inline h-3 w-3 mr-1" />}
                      {t(`status.${r.status}`)}
                    </span>
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
