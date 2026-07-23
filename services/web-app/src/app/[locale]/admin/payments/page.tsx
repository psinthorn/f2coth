"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Link } from "@/i18n/routing";
import AdminShell from "@/components/AdminShell";
import { toast } from "@/lib/toast";
import { adminApi, type AdminPaymentRow } from "@/lib/admin-api";
import { formatMoney, paymentStatusTone } from "@/lib/payment-types";

const STATUSES = ["awaiting_verification", "pending", "completed", "failed", ""] as const;

export default function AdminPaymentsPage() {
  const t = useTranslations("admin.payments");
  const tc = useTranslations("common");
  const [status, setStatus] = useState<string>("awaiting_verification");
  const [rows, setRows] = useState<AdminPaymentRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function load() {
    setRows(null);
    adminApi.listPayments(status ? { status } : undefined).then(setRows).catch(() => setRows([]));
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  async function verify(id: string) {
    setBusy(id);
    setMsg(null);
    try {
      await adminApi.verifyPayment(id);
      setMsg(t("verified"));
      toast.success(tc("toast.done"));
      load();
    } catch (e: unknown) {
      const err = e as { body?: string };
      setMsg(err.body || tc("error"));
      toast.error(err.body || tc("error"));
    } finally {
      setBusy(null);
    }
  }

  async function reject(id: string) {
    const reason = window.prompt(t("rejectReasonPrompt")) ?? "";
    if (!reason) return;
    setBusy(id);
    setMsg(null);
    try {
      await adminApi.rejectPayment(id, reason);
      setMsg(t("rejected"));
      toast.success(tc("toast.done"));
      load();
    } catch (e: unknown) {
      const err = e as { body?: string };
      setMsg(err.body || tc("error"));
      toast.error(err.body || tc("error"));
    } finally {
      setBusy(null);
    }
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
            {s ? t(`payStatus.${s}`) : t("all")}
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
                <th className="px-4 py-3 font-semibold">{t("col.payment")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.invoice")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.customer")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.method")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.slip")}</th>
                <th className="px-4 py-3 font-semibold text-right">{t("col.amount")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.status")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3 font-medium text-navy-900">{p.payment_number}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/invoices/${p.invoice_id}`}
                      className="text-accent-700 hover:underline"
                    >
                      {p.invoice_number ?? "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-navy-700">{p.customer_name ?? "—"}</td>
                  <td className="px-4 py-3 text-navy-700">{t(`methodLabel.${p.method}`)}</td>
                  <td className="px-4 py-3">
                    {p.slip_url ? (
                      <a href={p.slip_url} target="_blank" rel="noopener" className="text-accent-700 hover:underline text-xs">
                        {t("viewSlip")}
                      </a>
                    ) : (
                      <span className="text-navy-400 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">{formatMoney(p.amount_cents, p.currency)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${paymentStatusTone(p.status)}`}>
                      {t(`payStatus.${p.status}`)}
                    </span>
                  </td>
                  <td className="px-4 py-3 space-x-2 whitespace-nowrap">
                    {p.status === "awaiting_verification" && (
                      <>
                        <button
                          type="button"
                          disabled={busy === p.id}
                          onClick={() => verify(p.id)}
                          className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-100"
                        >
                          <CheckCircle2 className="h-3 w-3" /> {t("verify")}
                        </button>
                        <button
                          type="button"
                          disabled={busy === p.id}
                          onClick={() => reject(p.id)}
                          className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-xs text-red-800 hover:bg-red-100"
                        >
                          <XCircle className="h-3 w-3" /> {t("reject")}
                        </button>
                      </>
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
