"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Loader2, FlaskConical, Sparkles, Zap, CheckCircle2, AlertCircle, Trash2, ExternalLink,
} from "lucide-react";
import { Link } from "@/i18n/routing";
import AdminShell from "@/components/AdminShell";
import {
  adminApi,
  type SandboxInvoiceRow,
  type SandboxPaymentRow,
} from "@/lib/admin-api";
import { formatMoney, invoiceStatusTone, paymentStatusTone } from "@/lib/payment-types";

export default function AdminSandboxPage() {
  const t = useTranslations("admin.sandbox");
  const tc = useTranslations("common");
  const [invoices, setInvoices] = useState<SandboxInvoiceRow[] | null>(null);
  const [payments, setPayments] = useState<SandboxPaymentRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [forbidden, setForbidden] = useState(false);

  async function reload() {
    try {
      const [inv, pay] = await Promise.all([adminApi.sandboxInvoices(), adminApi.sandboxPayments()]);
      setInvoices(inv ?? []);
      setPayments(pay ?? []);
    } catch (e: unknown) {
      const err = e as { status?: number };
      if (err?.status === 403) setForbidden(true);
      else {
        setInvoices([]);
        setPayments([]);
      }
    }
  }
  useEffect(() => { void reload(); }, []);

  async function seed() {
    setBusy("seed");
    setMsg(null);
    try {
      const r = await adminApi.sandboxSeed();
      setMsg({ kind: "ok", text: t("seeded", { number: r.invoice_number }) });
      await reload();
    } catch (e: unknown) {
      const err = e as { body?: string };
      setMsg({ kind: "err", text: err.body || tc("error") });
    } finally {
      setBusy(null);
    }
  }

  async function completePayment(id: string) {
    setBusy(id);
    setMsg(null);
    try {
      await adminApi.sandboxCompletePayment(id);
      setMsg({ kind: "ok", text: t("payCompleted") });
      await reload();
    } catch (e: unknown) {
      const err = e as { body?: string };
      setMsg({ kind: "err", text: err.body || tc("error") });
    } finally {
      setBusy(null);
    }
  }

  async function simulateWebhook(id: string) {
    setBusy(id);
    setMsg(null);
    try {
      const r = await adminApi.sandboxSimulateWebhook(id);
      setMsg({ kind: "ok", text: t("webhookFired", { event: r.event_id }) });
      await reload();
    } catch (e: unknown) {
      const err = e as { body?: string };
      setMsg({ kind: "err", text: err.body || tc("error") });
    } finally {
      setBusy(null);
    }
  }

  async function purge() {
    if (!window.confirm(t("purgeConfirm"))) return;
    setBusy("purge");
    setMsg(null);
    try {
      const r = await adminApi.sandboxPurge();
      setMsg({ kind: "ok", text: t("purged", { count: r.deleted }) });
      await reload();
    } catch (e: unknown) {
      const err = e as { body?: string };
      setMsg({ kind: "err", text: err.body || tc("error") });
    } finally {
      setBusy(null);
    }
  }

  if (forbidden) {
    return (
      <AdminShell>
        <div className="card text-center">
          <FlaskConical className="mx-auto h-10 w-10 text-amber-500" />
          <h1 className="mt-3 font-display text-2xl text-navy-900">{t("disabledTitle")}</h1>
          <p className="mt-2 text-sm text-navy-600">{t("disabledBody")}</p>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <header className="mb-6 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl text-navy-900 flex items-center gap-2">
            <FlaskConical className="h-7 w-7 text-amber-500" />
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-navy-600">{t("subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-accent" disabled={busy === "seed"} onClick={seed}>
            {busy === "seed" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {t("seedInvoice")}
          </button>
          <button
            type="button"
            className="btn-secondary text-red-700 border-red-200 hover:bg-red-50"
            disabled={busy === "purge"}
            onClick={purge}
          >
            <Trash2 className="h-4 w-4" /> {t("purge")}
          </button>
        </div>
      </header>

      {msg && (
        <div
          className={`mb-4 rounded-md px-3 py-2 text-sm ${
            msg.kind === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"
          }`}
        >
          {msg.kind === "ok" ? <CheckCircle2 className="inline h-4 w-4 mr-1" /> : <AlertCircle className="inline h-4 w-4 mr-1" />}
          {msg.text}
        </div>
      )}

      <section className="mb-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-navy-500">
          {t("pendingPayments")}
        </h2>
        {payments === null ? (
          <div className="text-navy-500"><Loader2 className="inline h-4 w-4 animate-spin" /> {tc("loading")}</div>
        ) : payments.length === 0 ? (
          <div className="card text-center text-navy-500 text-sm">{t("noPending")}</div>
        ) : (
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-navy-50 text-left text-xs uppercase tracking-wider text-navy-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">{t("col.payment")}</th>
                  <th className="px-4 py-3 font-semibold">{t("col.invoice")}</th>
                  <th className="px-4 py-3 font-semibold">{t("col.method")}</th>
                  <th className="px-4 py-3 font-semibold text-right">{t("col.amount")}</th>
                  <th className="px-4 py-3 font-semibold">{t("col.status")}</th>
                  <th className="px-4 py-3 font-semibold">{t("col.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3 font-mono text-xs text-navy-700">{p.payment_number}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={{ pathname: "/admin/invoices/[id]", params: { id: p.invoice_id } } as never}
                        className="text-accent-700 hover:underline"
                      >
                        {p.invoice_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-navy-700 text-xs uppercase">{p.method}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(p.amount_cents, p.currency)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${paymentStatusTone(p.status as never)}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 space-x-2 whitespace-nowrap">
                      <button
                        type="button"
                        disabled={busy === p.id}
                        onClick={() => completePayment(p.id)}
                        className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-100"
                      >
                        <Zap className="h-3 w-3" /> {t("forceComplete")}
                      </button>
                      {p.method === "paypal" && (
                        <button
                          type="button"
                          disabled={busy === p.id}
                          onClick={() => simulateWebhook(p.id)}
                          className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900 hover:bg-amber-100"
                        >
                          <Sparkles className="h-3 w-3" /> {t("simulateWebhook")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-navy-500">
          {t("testInvoices")}
        </h2>
        {invoices === null ? (
          <div className="text-navy-500"><Loader2 className="inline h-4 w-4 animate-spin" /> {tc("loading")}</div>
        ) : invoices.length === 0 ? (
          <div className="card text-center text-navy-500 text-sm">{t("noInvoices")}</div>
        ) : (
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-navy-50 text-left text-xs uppercase tracking-wider text-navy-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">{t("col.invoice")}</th>
                  <th className="px-4 py-3 font-semibold">{t("col.customer")}</th>
                  <th className="px-4 py-3 font-semibold text-right">{t("col.total")}</th>
                  <th className="px-4 py-3 font-semibold text-right">{t("col.paid")}</th>
                  <th className="px-4 py-3 font-semibold">{t("col.status")}</th>
                  <th className="px-4 py-3 font-semibold">{tc("open")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="px-4 py-3 font-mono text-xs text-navy-700">{inv.invoice_number}</td>
                    <td className="px-4 py-3 text-navy-700">{inv.customer_name}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(inv.total_cents, inv.currency)}</td>
                    <td className="px-4 py-3 text-right text-emerald-700">
                      {formatMoney(inv.amount_paid_cents, inv.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${invoiceStatusTone(inv.status as never)}`}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={{ pathname: "/admin/invoices/[id]", params: { id: inv.id } } as never}
                        className="text-accent-700 hover:underline inline-flex items-center gap-1 text-xs"
                      >
                        {tc("open")} <ExternalLink className="h-3 w-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AdminShell>
  );
}
