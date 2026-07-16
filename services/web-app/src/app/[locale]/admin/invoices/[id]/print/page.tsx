"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Printer, ArrowLeft } from "lucide-react";
import { Link } from "@/i18n/routing";
import { adminApi, type AdminInvoiceFull } from "@/lib/admin-api";
import InvoiceDocument from "@/components/InvoiceDocument";

// Admin-side print view. Reads the invoice through the staff token so
// admins can print any customer's invoice on the customer's behalf.
export default function AdminInvoicePrintPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("portal.billing.print");
  const [inv, setInv] = useState<AdminInvoiceFull | null>(null);

  useEffect(() => {
    adminApi.getInvoice(id).then(setInv).catch(() => setInv(null));
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
      <div className="bg-white border-b border-navy-100 px-4 py-3 print:hidden">
        <div className="container-page flex items-center justify-between">
          <Link
            href={`/admin/invoices/${id}`}
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
