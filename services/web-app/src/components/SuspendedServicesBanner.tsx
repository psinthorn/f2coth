"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { PauseCircle } from "lucide-react";
import { Link } from "@/i18n/routing";
import { portalApi, type PortalSuspension } from "@/lib/portal-api";

// Top-of-portal banner that warns the customer when one or more of
// their services has been paused because of an unpaid invoice. Reads
// from /portal/suspensions on mount; silent when there's nothing to
// flag.
export default function SuspendedServicesBanner() {
  const t = useTranslations("portal.suspendedBanner");
  const [rows, setRows] = useState<PortalSuspension[]>([]);

  useEffect(() => {
    portalApi.listMySuspensions().then(setRows).catch(() => setRows([]));
  }, []);

  if (rows.length === 0) return null;

  // Group by invoice so the banner says "Invoice INV-... has 2 paused
  // services" instead of one row per resource.
  const byInvoice = new Map<string, { number: string; count: number }>();
  for (const r of rows) {
    const cur = byInvoice.get(r.invoice_id);
    byInvoice.set(r.invoice_id, {
      number: r.invoice_number,
      count: (cur?.count ?? 0) + 1,
    });
  }
  const first = Array.from(byInvoice.entries())[0];
  const [firstInvoiceID, firstInvoice] = first;

  return (
    <div className="w-full bg-red-100 border-b border-red-200 px-4 py-2 text-red-900">
      <div className="container-page flex items-center justify-between gap-3 text-xs sm:text-sm">
        <p className="flex items-center gap-2">
          <PauseCircle className="h-4 w-4 shrink-0" />
          <span>
            <strong>{t("badge")}</strong> ·{" "}
            {t("body", { count: rows.length, invoice: firstInvoice.number })}
          </span>
        </p>
        <Link
          href={{ pathname: "/portal/billing/[id]", params: { id: firstInvoiceID } } as never}
          className="rounded-md bg-red-200 px-2 py-1 font-medium hover:bg-red-300 whitespace-nowrap"
        >
          {t("payNow")}
        </Link>
      </div>
    </div>
  );
}
