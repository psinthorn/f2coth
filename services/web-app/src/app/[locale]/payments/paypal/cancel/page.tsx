"use client";

import { useTranslations } from "next-intl";
import { XCircle } from "lucide-react";
import { Link } from "@/i18n/routing";

export default function PayPalCancelPage() {
  const t = useTranslations("payments.paypal");
  return (
    <div className="grid min-h-[60vh] place-items-center px-4 py-10">
      <div className="card max-w-md w-full text-center">
        <XCircle className="mx-auto h-10 w-10 text-navy-400" />
        <h1 className="mt-3 font-display text-2xl text-navy-900">{t("cancelTitle")}</h1>
        <p className="mt-2 text-sm text-navy-600">{t("cancelBody")}</p>
        <Link href="/portal/billing" className="btn-accent mt-5 inline-flex">
          {t("backToBilling")}
        </Link>
      </div>
    </div>
  );
}
