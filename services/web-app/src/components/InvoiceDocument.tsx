"use client";

import { useTranslations, useLocale } from "next-intl";
import type { Invoice } from "@/lib/payment-types";
import { formatMoney } from "@/lib/payment-types";

// Shared print-ready document component. Used by both the portal print
// route and the admin print route — same DOM, identical pixel output.
// All text is bilingual EN+TH so a single physical print is acceptable
// to Thai accountants while still being readable internally.
//
// Designed for A4 with @media print rules in globals.css; nothing here
// depends on the surrounding shell so it can be served plain.
export default function InvoiceDocument({ invoice }: { invoice: Invoice }) {
  const t = useTranslations("portal.billing.print");
  const locale = useLocale();

  const due = invoice.total_cents - invoice.amount_paid_cents;
  const billing = (invoice.billing_snapshot ?? {}) as Record<string, unknown>;
  const buyerName    = (billing.legal_name    as string) || invoice.customer_name || "";
  const buyerTaxID   = (billing.tax_id        as string) || "";
  const buyerBranch  = (billing.branch_code   as string) || "00000";
  const buyerLines: string[] = [
    (billing.address_line1 as string) || "",
    (billing.address_line2 as string) || "",
    [
      (billing.subdistrict as string) || "",
      (billing.district    as string) || "",
      (billing.province    as string) || "",
      (billing.postal_code as string) || "",
    ].filter(Boolean).join(" "),
    (billing.country as string) || "",
  ].filter(Boolean);

  const docTitle = invoice.doc_type === "tax_invoice"
    ? `${t("docTaxInvoiceEN")} / ${t("docTaxInvoiceTH")}`
    : invoice.doc_type === "receipt"
    ? `${t("docReceiptEN")} / ${t("docReceiptTH")}`
    : invoice.doc_type === "quotation"
    ? `${t("docQuotationEN")} / ${t("docQuotationTH")}`
    : `${t("docInvoiceEN")} / ${t("docInvoiceTH")}`;

  return (
    <article className="invoice-doc mx-auto max-w-[210mm] bg-white p-10 text-navy-900 print:max-w-none print:p-8 print:text-[12pt]">
      {/* Header */}
      <header className="flex items-start justify-between border-b-2 border-navy-900 pb-4">
        <div>
          <h1 className="font-display text-2xl font-bold">F2 Co., Ltd.</h1>
          <p className="text-xs leading-snug text-navy-700">
            12/34 Moo 6, Bophut, Koh Samui<br />
            Surat Thani 84320, Thailand<br />
            {t("companyTaxID")}: 0105556012345<br />
            info@f2.co.th · +66 64 027 0528
          </p>
        </div>
        <div className="text-right">
          <h2 className="font-display text-xl font-bold uppercase tracking-wide">{docTitle}</h2>
          <p className="mt-1 text-sm">
            <span className="text-navy-500">{t("number")}:</span>{" "}
            <span className="font-mono">{invoice.invoice_number}</span>
          </p>
          {invoice.issue_date && (
            <p className="text-sm">
              <span className="text-navy-500">{t("issueDate")}:</span> {fmt(invoice.issue_date)}
            </p>
          )}
          {invoice.due_date && (
            <p className="text-sm">
              <span className="text-navy-500">{t("dueDate")}:</span> {fmt(invoice.due_date)}
            </p>
          )}
        </div>
      </header>

      {/* Buyer block */}
      <section className="mt-6 grid grid-cols-2 gap-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-navy-500">
            {t("billTo")} / ลูกค้า
          </p>
          <p className="mt-1 text-base font-semibold">{buyerName || "—"}</p>
          {buyerTaxID && (
            <p className="text-xs">
              {t("taxID")} {buyerTaxID} · {t("branch")} {buyerBranch}
            </p>
          )}
          {buyerLines.map((line, i) => (
            <p key={i} className="text-xs leading-snug">{line}</p>
          ))}
        </div>
        <div className="text-right text-xs text-navy-600">
          {invoice.notes && (
            <>
              <p className="font-semibold uppercase tracking-wider text-navy-500">{t("notes")}</p>
              <p className="mt-1 whitespace-pre-line">{invoice.notes}</p>
            </>
          )}
        </div>
      </section>

      {/* Line items */}
      <table className="mt-8 w-full border-collapse text-sm">
        <thead>
          <tr className="border-y-2 border-navy-900 text-xs uppercase tracking-wider">
            <th className="px-2 py-2 text-left font-semibold">{t("description")}</th>
            <th className="px-2 py-2 text-right font-semibold w-16">{t("qty")}</th>
            <th className="px-2 py-2 text-right font-semibold w-28">{t("unitPrice")}</th>
            <th className="px-2 py-2 text-right font-semibold w-32">{t("lineTotal")}</th>
          </tr>
        </thead>
        <tbody>
          {(invoice.items ?? []).map((it) => (
            <tr key={it.id} className="border-b border-navy-200 align-top">
              <td className="px-2 py-2">
                <p className="font-medium">
                  {locale === "th" && it.description_th ? it.description_th : it.description_en}
                </p>
                {locale === "th" && it.description_en && it.description_th && (
                  <p className="text-xs text-navy-500">{it.description_en}</p>
                )}
              </td>
              <td className="px-2 py-2 text-right">{it.quantity}</td>
              <td className="px-2 py-2 text-right font-mono">
                {formatMoney(it.unit_price_cents, invoice.currency)}
              </td>
              <td className="px-2 py-2 text-right font-mono">
                {formatMoney(it.total_cents, invoice.currency)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="text-sm">
          <tr>
            <td colSpan={3} className="px-2 py-1 text-right">{t("subtotal")}</td>
            <td className="px-2 py-1 text-right font-mono">{formatMoney(invoice.subtotal_cents, invoice.currency)}</td>
          </tr>
          <tr>
            <td colSpan={3} className="px-2 py-1 text-right">
              {t("vat", { rate: (invoice.vat_rate_bp / 100).toFixed(2) })}
            </td>
            <td className="px-2 py-1 text-right font-mono">{formatMoney(invoice.vat_cents, invoice.currency)}</td>
          </tr>
          <tr className="border-y-2 border-navy-900 font-bold">
            <td colSpan={3} className="px-2 py-2 text-right">{t("total")}</td>
            <td className="px-2 py-2 text-right font-mono text-lg">{formatMoney(invoice.total_cents, invoice.currency)}</td>
          </tr>
          {invoice.amount_paid_cents > 0 && (
            <tr className="text-emerald-700">
              <td colSpan={3} className="px-2 py-1 text-right">{t("paid")}</td>
              <td className="px-2 py-1 text-right font-mono">−{formatMoney(invoice.amount_paid_cents, invoice.currency)}</td>
            </tr>
          )}
          {due > 0 && invoice.status !== "paid" && (
            <tr className="font-semibold">
              <td colSpan={3} className="px-2 py-1 text-right">{t("balanceDue")}</td>
              <td className="px-2 py-1 text-right font-mono">{formatMoney(due, invoice.currency)}</td>
            </tr>
          )}
        </tfoot>
      </table>

      {/* Footer */}
      <footer className="mt-12 grid grid-cols-2 gap-6 text-xs text-navy-600">
        <div>
          <p className="font-semibold">{t("paymentInfo")}</p>
          <p className="mt-1 leading-snug">
            {t("paymentInstructions")}
          </p>
        </div>
        <div className="text-right">
          <div className="border-t border-navy-300 pt-2 mt-12 inline-block w-48">
            <p>{t("authorizedSignature")}</p>
            <p className="mt-1 text-[10px] text-navy-500">F2 Co., Ltd.</p>
          </div>
        </div>
      </footer>

      <p className="mt-8 text-center text-[10px] text-navy-400">
        {t("thanks")} · f2.co.th
      </p>
    </article>
  );
}

function fmt(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "2-digit",
  });
}
