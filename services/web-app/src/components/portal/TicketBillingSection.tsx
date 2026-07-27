"use client";

// Read-only billing summary shown to the customer on their portal ticket
// (migration 073): coverage note and/or itemized extra charge + invoice link.

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { ShieldCheck, Receipt, FileText } from "lucide-react";
import { formatMoney } from "@/lib/payment-types";
import { portalApi, type PortalTicketBilling, type PortalTicketLine } from "@/lib/portal-api";

// A draft invoice isn't visible to the customer in payment-api yet.
const VISIBLE_INVOICE = new Set(["issued", "partially_paid", "paid", "overdue", "refunded"]);

export default function TicketBillingSection({ ticketId }: { ticketId: string }) {
  const t = useTranslations("portal.tickets.billing");
  const locale = useLocale();
  const [b, setB] = useState<PortalTicketBilling | null>(null);

  useEffect(() => {
    portalApi.getTicketBilling(ticketId).then(setB).catch(() => setB(null));
  }, [ticketId]);

  // Nothing itemized yet → render nothing.
  if (!b || b.billing_status === "none") return null;

  const desc = (l: PortalTicketLine) => (locale === "th" && l.description_th ? l.description_th : l.description_en);
  const invoiceVisible = !!b.invoice_id && !!b.invoice_status && VISIBLE_INVOICE.has(b.invoice_status);
  const cur = b.currency;
  const billableLines = b.lines.filter((l) => !l.covered);

  return (
    <section className="card mb-4">
      <h2 className="flex items-center gap-2 font-semibold text-navy-900">
        <Receipt className="h-4 w-4 text-accent-700" /> {t("title")}
      </h2>

      {b.covered_by_title && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <ShieldCheck className="h-4 w-4 shrink-0" />
          <span>{t("coveredBy", { title: b.covered_by_title })}</span>
        </div>
      )}

      {billableLines.length > 0 ? (
        <>
          <div className="mt-3 divide-y divide-navy-100">
            {billableLines.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate text-navy-800">
                  {desc(l)} <span className="text-navy-400">· {l.quantity} × {formatMoney(l.unit_price_cents, cur)}</span>
                </span>
                <span className="shrink-0 font-medium text-navy-900">{formatMoney(l.amount_cents, cur)}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-1 border-t border-navy-100 pt-3 text-sm">
            <div className="flex justify-between text-navy-600"><span>{t("subtotal")}</span><span>{formatMoney(b.subtotal_cents, cur)}</span></div>
            <div className="flex justify-between text-navy-600"><span>{t("vat", { pct: b.vat_rate_bp / 100 })}</span><span>{formatMoney(b.vat_cents, cur)}</span></div>
            <div className="flex justify-between font-semibold text-navy-900"><span>{t("total")}</span><span>{formatMoney(b.total_cents, cur)}</span></div>
          </div>
          <p className="mt-3 text-xs text-navy-500">
            {invoiceVisible ? (
              <Link href={`/portal/billing` as any} className="inline-flex items-center gap-1 text-accent-700 hover:underline">
                <FileText className="h-3.5 w-3.5" /> {t("viewInvoice", { number: b.invoice_number ?? "" })}
              </Link>
            ) : t("invoiceToFollow")}
          </p>
        </>
      ) : (
        <p className="mt-3 text-sm text-emerald-700">{t("noCharge")}</p>
      )}
    </section>
  );
}
