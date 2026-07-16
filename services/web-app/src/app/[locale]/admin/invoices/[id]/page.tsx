"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Send, Ban, AlertCircle, CheckCircle2, Printer, RotateCcw } from "lucide-react";
import { Link } from "@/i18n/routing";
import AdminShell from "@/components/AdminShell";
import { adminApi, type AdminInvoiceFull } from "@/lib/admin-api";
import { formatMoney, invoiceStatusTone, paymentStatusTone } from "@/lib/payment-types";

export default function AdminInvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("admin.invoices");
  const tc = useTranslations("common");
  const [inv, setInv] = useState<AdminInvoiceFull | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [refundFor, setRefundFor] = useState<{ paymentId: string; max: number } | null>(null);

  function openRefund(paymentId: string, max: number) {
    setRefundFor({ paymentId, max });
  }

  // PDF download — fetch with the staff bearer then trigger a save
  // dialog. Browsers won't attach auth headers to a bare <a>.
  function downloadPDF(invoiceID: string, number: string) {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "/api";
    const tok = sessionStorage.getItem("f2_access_token");
    fetch(`${apiBase}${adminApi.invoicePDFPath(invoiceID)}`, {
      headers: tok ? { Authorization: `Bearer ${tok}` } : undefined,
    })
      .then((res) => res.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `${number}.pdf`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      });
  }

  async function load() {
    try {
      setInv(await adminApi.getInvoice(id));
    } catch {
      setInv(null);
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function issue() {
    setBusy(true);
    setMsg(null);
    try {
      setInv(await adminApi.issueInvoice(id));
      setMsg({ kind: "ok", text: t("issued") });
    } catch (e: unknown) {
      const err = e as { body?: string };
      setMsg({ kind: "err", text: err.body || "" });
    } finally {
      setBusy(false);
    }
  }

  async function voidIt() {
    const reason = window.prompt(t("voidReasonPrompt")) ?? "";
    if (!reason) return;
    setBusy(true);
    setMsg(null);
    try {
      setInv(await adminApi.voidInvoice(id, reason));
      setMsg({ kind: "ok", text: t("voided") });
    } catch (e: unknown) {
      const err = e as { body?: string };
      setMsg({ kind: "err", text: err.body || "" });
    } finally {
      setBusy(false);
    }
  }

  if (!inv) {
    return (
      <AdminShell>
        <div className="text-navy-500"><Loader2 className="inline h-4 w-4 animate-spin" /> {tc("loading")}</div>
      </AdminShell>
    );
  }

  const due = inv.total_cents - inv.amount_paid_cents;

  return (
    <AdminShell>
      <div className="mb-3 text-xs">
        <Link href="/admin/invoices" className="text-navy-500 hover:text-navy-700">← {t("backToList")}</Link>
      </div>
      <header className="mb-6 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl text-navy-900">{inv.invoice_number}</h1>
          <p className="mt-1 text-sm text-navy-600">
            {inv.customer_name}
            {inv.issue_date && ` · ${t("issued")} ${inv.issue_date}`}
            {inv.due_date && ` · ${t("due")} ${inv.due_date}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs ${invoiceStatusTone(inv.status)}`}>
            {t(`status.${inv.status}`)}
          </span>
          {inv.status === "draft" && (
            <button type="button" className="btn-accent" disabled={busy} onClick={issue}>
              <Send className="h-4 w-4" /> {t("issue")}
            </button>
          )}
          {["draft", "issued", "partially_paid", "overdue"].includes(inv.status) && (
            <button type="button" className="btn-secondary" disabled={busy} onClick={voidIt}>
              <Ban className="h-4 w-4" /> {t("void")}
            </button>
          )}
          <Link
            href={`/admin/invoices/${id}/print`}
            target="_blank"
            className="btn-secondary"
          >
            <Printer className="h-4 w-4" /> {t("print")}
          </Link>
          <button type="button" className="btn-secondary" onClick={() => downloadPDF(id, inv.invoice_number)}>
            <Printer className="h-4 w-4" /> {t("downloadPDF")}
          </button>
        </div>
      </header>

      {msg && (
        <div className={`mb-4 rounded-md px-3 py-2 text-sm ${msg.kind === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
          {msg.kind === "ok" ? <CheckCircle2 className="inline h-4 w-4 mr-1" /> : <AlertCircle className="inline h-4 w-4 mr-1" />}
          {msg.text}
        </div>
      )}

      <section className="card mb-6 p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-navy-50 text-left text-xs uppercase tracking-wider text-navy-500">
            <tr>
              <th className="px-4 py-3 font-semibold">{t("col.description")}</th>
              <th className="px-4 py-3 font-semibold text-right">{t("col.qty")}</th>
              <th className="px-4 py-3 font-semibold text-right">{t("col.unitPrice")}</th>
              <th className="px-4 py-3 font-semibold text-right">{t("col.lineTotal")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-100">
            {inv.items.map((it) => (
              <tr key={it.id}>
                <td className="px-4 py-3">
                  <p className="text-navy-900">{it.description_en}</p>
                  {it.description_th && <p className="text-xs text-navy-500">{it.description_th}</p>}
                </td>
                <td className="px-4 py-3 text-right">{it.quantity}</td>
                <td className="px-4 py-3 text-right">{formatMoney(it.unit_price_cents, inv.currency)}</td>
                <td className="px-4 py-3 text-right font-medium">{formatMoney(it.total_cents, inv.currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-navy-50/60 text-sm">
            <tr><td colSpan={3} className="px-4 py-2 text-right text-navy-600">{t("subtotal")}</td>
              <td className="px-4 py-2 text-right">{formatMoney(inv.subtotal_cents, inv.currency)}</td></tr>
            <tr><td colSpan={3} className="px-4 py-2 text-right text-navy-600">
              {t("vat", { rate: (inv.vat_rate_bp / 100).toFixed(2) })}</td>
              <td className="px-4 py-2 text-right">{formatMoney(inv.vat_cents, inv.currency)}</td></tr>
            <tr className="font-semibold"><td colSpan={3} className="px-4 py-3 text-right">{t("total")}</td>
              <td className="px-4 py-3 text-right">{formatMoney(inv.total_cents, inv.currency)}</td></tr>
            <tr className="text-emerald-700"><td colSpan={3} className="px-4 py-2 text-right">{t("paid")}</td>
              <td className="px-4 py-2 text-right">{formatMoney(inv.amount_paid_cents, inv.currency)}</td></tr>
            {due > 0 && inv.status !== "paid" && (
              <tr className="text-amber-800 font-semibold"><td colSpan={3} className="px-4 py-2 text-right">{t("balanceDue")}</td>
                <td className="px-4 py-2 text-right">{formatMoney(due, inv.currency)}</td></tr>
            )}
          </tfoot>
        </table>
      </section>

      <section className="card">
        <h2 className="font-display text-lg text-navy-900 mb-3">{t("paymentsTitle")}</h2>
        {inv.payments.length === 0 ? (
          <p className="text-navy-500 text-sm">{t("noPayments")}</p>
        ) : (
          <ul className="divide-y divide-navy-100">
            {inv.payments.map((p) => (
              <li key={p.id} className="py-3 flex items-center justify-between gap-3 text-sm">
                <div>
                  <p className="font-medium text-navy-900">{p.payment_number}</p>
                  <p className="text-xs text-navy-500">
                    {t(`methodLabel.${p.method}`)} · {new Date(p.created_at).toLocaleString()}
                    {p.slip_url && (
                      <> · <a href={p.slip_url} target="_blank" rel="noopener" className="text-accent-700 hover:underline">{t("viewSlip")}</a></>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="font-medium">{formatMoney(p.amount_cents, p.currency)}</p>
                    <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-xs ${paymentStatusTone(p.status)}`}>
                      {t(`payStatus.${p.status}`)}
                    </span>
                  </div>
                  {p.status === "completed" && (
                    <button
                      type="button"
                      onClick={() => openRefund(p.id, p.amount_cents)}
                      className="rounded-md bg-red-50 px-2 py-1 text-xs text-red-800 hover:bg-red-100 inline-flex items-center gap-1 whitespace-nowrap"
                    >
                      <RotateCcw className="h-3 w-3" /> {t("refund")}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {refundFor && (
        <RefundDialog
          paymentId={refundFor.paymentId}
          max={refundFor.max}
          currency={inv.currency}
          onClose={() => setRefundFor(null)}
          onDone={() => {
            setRefundFor(null);
            void load();
            setMsg({ kind: "ok", text: t("refundIssued") });
          }}
        />
      )}
    </AdminShell>
  );
}

function RefundDialog({
  paymentId, max, currency, onClose, onDone,
}: {
  paymentId: string;
  max: number;
  currency: "THB" | "USD";
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("admin.invoices");
  const [amount, setAmount] = useState<number>(max);
  const [reason, setReason] = useState("");
  const [bankRef, setBankRef] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!reason || amount <= 0 || amount > max) {
      setErr(t("refundInvalid"));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await adminApi.createRefund({
        payment_id: paymentId,
        amount_cents: amount,
        reason,
        bank_ref: bankRef || undefined,
        proof_url: proofUrl || undefined,
      });
      onDone();
    } catch (e: unknown) {
      const v = e as { body?: string };
      setErr(v.body || t("refundFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-navy-900/40 backdrop-blur-sm grid place-items-center p-4">
      <div className="card max-w-md w-full">
        <h3 className="font-display text-lg text-navy-900 mb-3">{t("refundDialogTitle")}</h3>
        <div className="grid gap-3 text-sm">
          <label className="grid gap-1 text-xs text-navy-600">
            {t("refundAmount")} ({formatMoney(max, currency)} {t("maxRefund")})
            <input type="number" min={1} max={max} value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="rounded-md border border-navy-200 px-3 py-2 text-sm" />
          </label>
          <label className="grid gap-1 text-xs text-navy-600">
            {t("refundReason")} *
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
              className="rounded-md border border-navy-200 px-3 py-2 text-sm" />
          </label>
          <label className="grid gap-1 text-xs text-navy-600">
            {t("refundBankRef")}
            <input type="text" value={bankRef} onChange={(e) => setBankRef(e.target.value)}
              className="rounded-md border border-navy-200 px-3 py-2 text-sm" />
          </label>
          <label className="grid gap-1 text-xs text-navy-600">
            {t("refundProofUrl")}
            <input type="url" value={proofUrl} onChange={(e) => setProofUrl(e.target.value)}
              className="rounded-md border border-navy-200 px-3 py-2 text-sm" />
          </label>
        </div>
        {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            {t("cancel")}
          </button>
          <button type="button" onClick={submit} disabled={busy} className="btn-accent">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            <RotateCcw className="h-4 w-4" /> {t("issueRefund")}
          </button>
        </div>
      </div>
    </div>
  );
}
