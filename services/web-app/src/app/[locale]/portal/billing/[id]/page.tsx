"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import {
  Loader2, Receipt, CreditCard, Landmark, QrCode, Smartphone, CheckCircle2, AlertCircle, Upload, Printer,
} from "lucide-react";
import { Link } from "@/i18n/routing";
import PortalShell from "@/components/PortalShell";
import {
  portalApi,
  type PortalInvoiceFull,
  type PortalPaymentMethod,
  type PortalPaymentMethodConfig,
} from "@/lib/portal-api";
import {
  formatMoney, invoiceStatusTone, paymentStatusTone,
  type PaymentMethod, type BankAccount,
} from "@/lib/payment-types";

const METHOD_ICONS: Record<PaymentMethod, typeof Landmark> = {
  bank_transfer: Landmark,
  thai_qr: QrCode,
  promptpay: Smartphone,
  paypal: CreditCard,
};

export default function PortalInvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations("portal.billing");
  const tc = useTranslations("common");
  const locale = useLocale();

  const [invoice, setInvoice] = useState<PortalInvoiceFull | null>(null);
  const [methods, setMethods] = useState<PortalPaymentMethodConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<PaymentMethod | null>(null);
  const [busy, setBusy] = useState(false);
  const [activePaymentId, setActivePaymentId] = useState<string | null>(null);
  const [activeConfig, setActiveConfig] = useState<Record<string, unknown> | null>(null);
  const [slip, setSlip] = useState({ slip_url: "", bank_ref: "", transferred_at: "" });
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function downloadPortalPDF(invoiceID: string, number: string, doc?: "receipt") {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "/api";
    const tok = sessionStorage.getItem("f2_portal_access_token");
    fetch(`${apiBase}${portalApi.invoicePDFPath(invoiceID, doc)}`, {
      headers: tok ? { Authorization: `Bearer ${tok}` } : undefined,
    })
      .then((res) => res.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = doc === "receipt" ? `${number}-receipt.pdf` : `${number}.pdf`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      });
  }

  async function load() {
    setLoading(true);
    try {
      const [inv, ms] = await Promise.all([
        portalApi.getInvoice(id),
        portalApi.publicPaymentMethods().catch(() => [] as PortalPaymentMethodConfig[]),
      ]);
      setInvoice(inv);
      setMethods(ms);
    } catch {
      setInvoice(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) {
    return (
      <PortalShell>
        <div className="flex items-center gap-2 text-navy-500">
          <Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}
        </div>
      </PortalShell>
    );
  }
  if (!invoice) {
    return (
      <PortalShell>
        <div className="card text-center text-navy-500">{t("notFound")}</div>
      </PortalShell>
    );
  }

  const due = invoice.total_cents - invoice.amount_paid_cents;
  const payable = ["issued", "partially_paid", "overdue"].includes(invoice.status) && due > 0;

  async function initPayment(method: PaymentMethod) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await portalApi.initPayment(id, method);
      setActivePaymentId(r.payment_id);
      setActiveConfig(r.method_config ?? null);
      if (method === "paypal" && r.approval_url) {
        window.location.href = r.approval_url;
        return;
      }
    } catch (e: unknown) {
      const err = e as { status?: number; body?: string };
      setMsg({ kind: "err", text: err.body || t("payError") });
    } finally {
      setBusy(false);
    }
  }

  async function submitSlip() {
    if (!activePaymentId) return;
    if (!slip.slip_url) {
      setMsg({ kind: "err", text: t("slipUrlRequired") });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await portalApi.uploadSlip(activePaymentId, {
        slip_url: slip.slip_url,
        bank_ref: slip.bank_ref || undefined,
        transferred_at: slip.transferred_at || undefined,
      });
      setMsg({ kind: "ok", text: t("slipSubmitted") });
      setActivePaymentId(null);
      setActiveConfig(null);
      setSelected(null);
      await load();
    } catch (e: unknown) {
      const err = e as { body?: string };
      setMsg({ kind: "err", text: err.body || t("payError") });
    } finally {
      setBusy(false);
    }
  }

  const visibleMethods = methods.filter((m) => m.enabled);

  return (
    <PortalShell>
      <div className="mb-4 text-xs">
        <Link href="/portal/billing" className="text-navy-500 hover:text-navy-700">
          ← {t("backToList")}
        </Link>
      </div>

      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl text-navy-900 flex items-center gap-2">
            <Receipt className="h-6 w-6 text-navy-400" />
            {invoice.invoice_number}
          </h1>
          <p className="mt-1 text-sm text-navy-600">
            {invoice.issue_date && `${t("issued")} ${invoice.issue_date}`}
            {invoice.due_date && ` · ${t("due")} ${invoice.due_date}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/portal/billing/${invoice.id}/print`}
            target="_blank"
            className="btn-secondary text-xs"
          >
            <Printer className="h-3.5 w-3.5" /> {t("printDocument")}
          </Link>
          <button type="button" className="btn-secondary text-xs" onClick={() => downloadPortalPDF(invoice.id, invoice.invoice_number)}>
            <Printer className="h-3.5 w-3.5" /> {t("downloadPDF")}
          </button>
          {invoice.status === "paid" && (
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => downloadPortalPDF(invoice.id, invoice.invoice_number, "receipt")}
            >
              <Printer className="h-3.5 w-3.5" /> {t("downloadReceipt")}
            </button>
          )}
          <span className={`rounded-full px-3 py-1 text-xs ${invoiceStatusTone(invoice.status)}`}>
            {t(`status.${invoice.status}`)}
          </span>
        </div>
      </header>

      <section className="card mb-6 p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-navy-50 text-left text-xs uppercase tracking-wider text-navy-500">
            <tr>
              <th className="px-4 py-3 font-semibold">{t("col.description")}</th>
              <th className="px-4 py-3 font-semibold text-right">{t("col.qty")}</th>
              <th className="px-4 py-3 font-semibold text-right">{t("col.unitPrice")}</th>
              <th className="px-4 py-3 font-semibold text-right">{t("col.total")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-100">
            {(invoice.items ?? []).map((it) => (
              <tr key={it.id}>
                <td className="px-4 py-3 text-navy-700">
                  {locale === "th" && it.description_th ? it.description_th : it.description_en}
                </td>
                <td className="px-4 py-3 text-right text-navy-700">{it.quantity}</td>
                <td className="px-4 py-3 text-right text-navy-700">
                  {formatMoney(it.unit_price_cents, invoice.currency)}
                </td>
                <td className="px-4 py-3 text-right text-navy-900 font-medium">
                  {formatMoney(it.total_cents, invoice.currency)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-navy-50/60 text-sm">
            <tr>
              <td colSpan={3} className="px-4 py-2 text-right text-navy-600">{t("subtotal")}</td>
              <td className="px-4 py-2 text-right">{formatMoney(invoice.subtotal_cents, invoice.currency)}</td>
            </tr>
            <tr>
              <td colSpan={3} className="px-4 py-2 text-right text-navy-600">
                {t("vat", { rate: (invoice.vat_rate_bp / 100).toFixed(2) })}
              </td>
              <td className="px-4 py-2 text-right">{formatMoney(invoice.vat_cents, invoice.currency)}</td>
            </tr>
            <tr className="font-semibold text-navy-900">
              <td colSpan={3} className="px-4 py-3 text-right">{t("total")}</td>
              <td className="px-4 py-3 text-right">{formatMoney(invoice.total_cents, invoice.currency)}</td>
            </tr>
            {invoice.amount_paid_cents > 0 && (
              <tr className="text-emerald-700">
                <td colSpan={3} className="px-4 py-2 text-right">{t("paid")}</td>
                <td className="px-4 py-2 text-right">−{formatMoney(invoice.amount_paid_cents, invoice.currency)}</td>
              </tr>
            )}
            {due > 0 && invoice.status !== "paid" && (
              <tr className="text-amber-800 font-semibold">
                <td colSpan={3} className="px-4 py-2 text-right">{t("balanceDue")}</td>
                <td className="px-4 py-2 text-right">{formatMoney(due, invoice.currency)}</td>
              </tr>
            )}
          </tfoot>
        </table>
      </section>

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

      {payable && !activePaymentId && (
        <section className="card mb-6">
          <h2 className="font-display text-lg text-navy-900 mb-3">{t("payTitle")}</h2>
          <p className="mb-4 text-sm text-navy-600">{t("paySubtitle")}</p>
          {visibleMethods.length === 0 ? (
            <p className="text-sm text-navy-500">{t("noMethods")}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {visibleMethods.map((m) => {
                const Icon = METHOD_ICONS[m.method];
                const isSel = selected === m.method;
                return (
                  <button
                    key={m.method}
                    type="button"
                    onClick={() => setSelected(m.method)}
                    className={`text-left rounded-lg border p-4 transition ${
                      isSel ? "border-accent-500 bg-accent-50/30" : "border-navy-100 hover:border-navy-300"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <Icon className="h-5 w-5 text-navy-500 mt-0.5" />
                      <div>
                        <p className="font-medium text-navy-900">
                          {locale === "th" ? m.display_name_th : m.display_name_en}
                        </p>
                        <p className="mt-1 text-xs text-navy-500">
                          {locale === "th" ? m.instructions_th : m.instructions_en}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {selected && (
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                className="btn-accent"
                disabled={busy}
                onClick={() => initPayment(selected)}
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {selected === "paypal" ? t("continueToPayPal") : t("continueToPay")}
              </button>
            </div>
          )}
        </section>
      )}

      {activePaymentId && activeConfig && selected && selected !== "paypal" && (
        <ManualPayInstructions
          method={selected}
          config={activeConfig}
          slip={slip}
          setSlip={setSlip}
          submit={submitSlip}
          busy={busy}
          locale={locale}
          paymentId={activePaymentId}
        />
      )}

      {(invoice.payments ?? []).length > 0 && (
        <section className="card">
          <h2 className="font-display text-lg text-navy-900 mb-3">{t("paymentHistory")}</h2>
          <ul className="divide-y divide-navy-100">
            {(invoice.payments ?? []).map((p) => (
              <li key={p.id} className="py-3 flex items-center justify-between gap-3 text-sm">
                <div>
                  <p className="font-medium text-navy-900">{p.payment_number}</p>
                  <p className="text-xs text-navy-500">
                    {t(`methodLabel.${p.method}`)} · {new Date(p.created_at).toLocaleString()}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-medium">{formatMoney(p.amount_cents, p.currency)}</p>
                  <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-xs ${paymentStatusTone(p.status)}`}>
                    {t(`payStatus.${p.status}`)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PortalShell>
  );
}

// Renders every enabled bank account under the bank_transfer method. The
// customer picks whichever bank is easiest and transfers to it.
function BankTransferAccounts({
  banks, t,
}: {
  banks: BankAccount[];
  t: ReturnType<typeof useTranslations>;
}) {
  const shown = banks.filter((b) => b.enabled && b.account_number);
  if (shown.length === 0) {
    return <p className="mb-5 text-sm text-navy-500">{t("noBanks")}</p>;
  }
  const row = (label: string, value: string) => (
    <div className="flex items-start justify-between gap-3 border-b border-navy-50 pb-1">
      <dt className="text-navy-500 text-xs uppercase tracking-wider">{label}</dt>
      <dd className="text-navy-900 font-mono text-right break-all">{value}</dd>
    </div>
  );
  return (
    <div className="mb-5 grid gap-3">
      {shown.length > 1 && <p className="text-xs text-navy-500">{t("bankChooseAny")}</p>}
      {shown.map((b) => (
        <div key={b.id} className="rounded-lg border border-navy-100 bg-navy-50/40 p-3">
          <p className="mb-2 inline-flex items-center gap-2 font-semibold text-navy-900">
            <Landmark className="h-4 w-4 text-navy-400" /> {b.bank_name}
          </p>
          <dl className="grid gap-1.5 text-sm">
            {row(t("cfg.account_name"), b.account_name)}
            {row(t("cfg.account_number"), b.account_number)}
            {b.branch ? row(t("cfg.branch"), b.branch) : null}
            {b.branch_address ? row(t("cfg.branch_address"), b.branch_address) : null}
            {b.swift ? row(t("cfg.swift"), b.swift) : null}
          </dl>
        </div>
      ))}
    </div>
  );
}

function ManualPayInstructions({
  method, config, slip, setSlip, submit, busy, locale, paymentId,
}: {
  method: PaymentMethod;
  config: Record<string, unknown>;
  slip: { slip_url: string; bank_ref: string; transferred_at: string };
  setSlip: (s: { slip_url: string; bank_ref: string; transferred_at: string }) => void;
  submit: () => void;
  busy: boolean;
  locale: string;
  paymentId: string;
}) {
  const t = useTranslations("portal.billing");
  return (
    <section className="card mb-6">
      <h2 className="font-display text-lg text-navy-900 mb-3">{t(`payInstructions.${method}`)}</h2>
      {Array.isArray((config as { banks?: unknown }).banks) ? (
        <BankTransferAccounts banks={(config as { banks: BankAccount[] }).banks} t={t} />
      ) : (
        <dl className="grid gap-2 text-sm mb-5">
          {Object.entries(config).map(([k, v]) => {
            if (!v) return null;
            if (k === "qr_image_url" && typeof v === "string") {
              return (
                <div key={k} className="my-2">
                  <img src={v} alt="QR" className="mx-auto h-48 w-48 rounded-md border border-navy-100" />
                </div>
              );
            }
            return (
              <div key={k} className="flex items-start justify-between gap-3 border-b border-navy-50 pb-1">
                <dt className="text-navy-500 text-xs uppercase tracking-wider">{t(`cfg.${k}`, { defaultMessage: k })}</dt>
                <dd className="text-navy-900 font-mono text-right break-all">{String(v)}</dd>
              </div>
            );
          })}
        </dl>
      )}

      <h3 className="text-sm font-semibold text-navy-900 mb-2">{t("uploadSlip")}</h3>
      <p className="text-xs text-navy-500 mb-3">{t("uploadSlipHintV2")}</p>
      <div className="grid gap-3">
        <SlipFilePicker
          paymentId={paymentId}
          value={slip.slip_url}
          onPicked={(url) => setSlip({ ...slip, slip_url: url })}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs text-navy-600">
            {t("bankRef")}
            <input
              type="text"
              value={slip.bank_ref}
              onChange={(e) => setSlip({ ...slip, bank_ref: e.target.value })}
              className="rounded-md border border-navy-200 px-3 py-2 text-sm"
            />
          </label>
          <label className="grid gap-1 text-xs text-navy-600">
            {t("transferredAt")}
            <input
              type="datetime-local"
              value={slip.transferred_at}
              onChange={(e) => setSlip({ ...slip, transferred_at: e.target.value })}
              className="rounded-md border border-navy-200 px-3 py-2 text-sm"
              lang={locale}
            />
          </label>
        </div>
        <div className="flex justify-end">
          <button type="button" className="btn-accent" disabled={busy} onClick={submit}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("submitSlip")}
          </button>
        </div>
      </div>
    </section>
  );
}

// SlipFilePicker — drag-drop + click-to-pick replacement for the old
// "paste URL" input. Uploads via portalApi.uploadSlipFile which streams
// the bytes into payment_slip_files (5 MB cap, image/* + pdf only).
// On success the parent's slip_url state is set to the served URL.
function SlipFilePicker({
  paymentId, value, onPicked,
}: {
  paymentId: string;
  value: string;
  onPicked: (url: string) => void;
}) {
  const t = useTranslations("portal.billing");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function handleFile(file: File) {
    setErr(null);
    if (file.size > 5 * 1024 * 1024) {
      setErr(t("slipFileTooBig"));
      return;
    }
    setBusy(true);
    try {
      const r = await portalApi.uploadSlipFile(paymentId, file);
      onPicked(r.slip_url);
    } catch (e: unknown) {
      const v = e as { body?: string };
      setErr(v.body || t("slipFileError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-1">
      <label
        className={`relative flex flex-col items-center gap-2 rounded-md border-2 border-dashed p-4 text-center cursor-pointer transition ${
          dragging ? "border-accent-500 bg-accent-50/30" : "border-navy-200 hover:border-navy-300"
        }`}
        onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void handleFile(f);
        }}
      >
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
          disabled={busy}
        />
        {busy ? (
          <Loader2 className="h-6 w-6 animate-spin text-navy-400" />
        ) : value ? (
          <>
            <CheckCircle2 className="h-6 w-6 text-emerald-600" />
            <p className="text-sm font-medium text-navy-900">{t("slipUploaded")}</p>
            <p className="text-xs text-navy-500 break-all">{value}</p>
            <p className="text-xs text-accent-700 underline">{t("slipReplace")}</p>
          </>
        ) : (
          <>
            <Upload className="h-6 w-6 text-navy-400" />
            <p className="text-sm text-navy-700">{t("slipDropHere")}</p>
            <p className="text-xs text-navy-500">{t("slipAccept")}</p>
          </>
        )}
      </label>
      {err && <p className="text-xs text-red-700">{err}</p>}
    </div>
  );
}
