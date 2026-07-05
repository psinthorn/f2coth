"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Receipt, ArrowRight } from "lucide-react";
import { Link } from "@/i18n/routing";
import PortalShell from "@/components/PortalShell";
import { portalApi, type PortalInvoiceSummary } from "@/lib/portal-api";
import { formatMoney, invoiceStatusTone } from "@/lib/payment-types";

export default function PortalBillingPage() {
  const t = useTranslations("portal.billing");
  const tc = useTranslations("common");
  const [invoices, setInvoices] = useState<PortalInvoiceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    portalApi
      .listInvoices()
      .then((list) => setInvoices(list ?? []))
      .catch((e: { status?: number }) => {
        if (e?.status === 404) setError("notFound");
        else setError("loadFailed");
        setInvoices([]);
      });
  }, []);

  const outstanding = (invoices ?? []).filter(
    (i) => i.status === "issued" || i.status === "partially_paid" || i.status === "overdue",
  );
  const settled = (invoices ?? []).filter(
    (i) => i.status === "paid" || i.status === "void" || i.status === "refunded",
  );

  return (
    <PortalShell>
      <header className="mb-6">
        <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-navy-600">{t("subtitle")}</p>
      </header>

      {invoices === null ? (
        <div className="flex items-center gap-2 text-navy-500">
          <Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}
        </div>
      ) : invoices.length === 0 ? (
        <div className="card text-center text-navy-500">{t("noneYet")}</div>
      ) : (
        <>
          {outstanding.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-navy-500">
                {t("outstandingTitle")}
              </h2>
              <div className="grid gap-3">
                {outstanding.map((inv) => (
                  <InvoiceRow key={inv.id} inv={inv} highlight />
                ))}
              </div>
            </section>
          )}
          {settled.length > 0 && (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-navy-500">
                {t("historyTitle")}
              </h2>
              <div className="grid gap-3">
                {settled.map((inv) => (
                  <InvoiceRow key={inv.id} inv={inv} />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {error === "loadFailed" && (
        <p className="mt-4 text-sm text-red-700">{t("loadError")}</p>
      )}
    </PortalShell>
  );
}

function InvoiceRow({ inv, highlight }: { inv: PortalInvoiceSummary; highlight?: boolean }) {
  const t = useTranslations("portal.billing");
  const due = inv.total_cents - inv.amount_paid_cents;
  return (
    <Link
      href={{ pathname: "/portal/billing/[id]", params: { id: inv.id } } as never}
      className={`card flex items-center justify-between gap-4 hover:border-accent-300 transition ${highlight ? "border-accent-200" : ""}`}
    >
      <div className="flex items-start gap-3">
        <Receipt className="h-5 w-5 text-navy-400 mt-0.5" />
        <div>
          <p className="font-medium text-navy-900">{inv.invoice_number}</p>
          <p className="mt-0.5 text-xs text-navy-500">
            {inv.issue_date && `${t("issued")} ${inv.issue_date}`}
            {inv.due_date && ` · ${t("due")} ${inv.due_date}`}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="font-semibold text-navy-900">
            {formatMoney(inv.total_cents, inv.currency)}
          </p>
          {due > 0 && inv.status !== "paid" && (
            <p className="text-xs text-amber-700">
              {t("dueAmount", { amount: formatMoney(due, inv.currency) })}
            </p>
          )}
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs ${invoiceStatusTone(inv.status)}`}>
          {t(`status.${inv.status}`)}
        </span>
        <ArrowRight className="h-4 w-4 text-navy-400" />
      </div>
    </Link>
  );
}
