"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Printer, ArrowLeft } from "lucide-react";
import { Link } from "@/i18n/routing";
import { portalApi, type PortalInvoiceFull } from "@/lib/portal-api";
import InvoiceDocument from "@/components/InvoiceDocument";
import { redirectToPortalLogin } from "@/lib/portal-api";

// Print-ready invoice/tax-invoice/receipt page. Auto-triggers the
// browser print dialog on first paint so users can save to PDF with
// one keystroke (Cmd+P / Ctrl+P).
export default function PortalInvoicePrintPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("portal.billing.print");
  const [inv, setInv] = useState<PortalInvoiceFull | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && !sessionStorage.getItem("f2_portal_access_token")) {
      redirectToPortalLogin();
      return;
    }
    portalApi.getInvoice(id).then(setInv).catch(() => setInv(null));
  }, [id]);

  if (!inv) {
    return (
      <div className="grid min-h-screen place-items-center text-navy-500">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-navy-50 min-h-screen">
      {/* Action bar — hidden when printing */}
      <div className="bg-white border-b border-navy-100 px-4 py-3 print:hidden">
        <div className="container-page flex items-center justify-between">
          <Link
            href={{ pathname: "/portal/billing/[id]", params: { id } } as never}
            className="text-sm text-navy-600 hover:text-navy-900 inline-flex items-center gap-1"
          >
            <ArrowLeft className="h-4 w-4" /> {t("back")}
          </Link>
          <button
            type="button"
            onClick={() => window.print()}
            className="btn-accent"
          >
            <Printer className="h-4 w-4" /> {t("print")}
          </button>
        </div>
      </div>

      <main className="py-8 print:py-0">
        <InvoiceDocument invoice={inv} />
      </main>
    </div>
  );
}
