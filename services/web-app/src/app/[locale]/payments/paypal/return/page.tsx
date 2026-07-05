"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Link } from "@/i18n/routing";
import { portalApi } from "@/lib/portal-api";

function PayPalReturnInner() {
  const t = useTranslations("payments.paypal");
  const params = useSearchParams();
  const paymentId = params.get("payment");
  const [state, setState] = useState<"capturing" | "ok" | "err">("capturing");
  const [errBody, setErrBody] = useState<string>("");

  useEffect(() => {
    if (!paymentId) {
      setState("err");
      return;
    }
    portalApi
      .capturePayPal(paymentId)
      .then((r) => {
        if (r.status === "completed") setState("ok");
        else setState("err");
      })
      .catch((e: { body?: string }) => {
        setErrBody(e?.body ?? "");
        setState("err");
      });
  }, [paymentId]);

  return (
    <div className="grid min-h-[60vh] place-items-center px-4 py-10">
      <div className="card max-w-md w-full text-center">
        {state === "capturing" && (
          <>
            <Loader2 className="mx-auto h-8 w-8 text-navy-400 animate-spin" />
            <p className="mt-4 text-navy-700">{t("capturing")}</p>
          </>
        )}
        {state === "ok" && (
          <>
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
            <h1 className="mt-3 font-display text-2xl text-navy-900">{t("successTitle")}</h1>
            <p className="mt-2 text-sm text-navy-600">{t("successBody")}</p>
            <Link href="/portal/billing" className="btn-accent mt-5 inline-flex">
              {t("backToBilling")}
            </Link>
          </>
        )}
        {state === "err" && (
          <>
            <AlertCircle className="mx-auto h-10 w-10 text-red-600" />
            <h1 className="mt-3 font-display text-2xl text-navy-900">{t("errorTitle")}</h1>
            <p className="mt-2 text-sm text-navy-600">{t("errorBody")}</p>
            {errBody && <p className="mt-3 text-xs text-navy-400 font-mono break-all">{errBody}</p>}
            <Link href="/portal/billing" className="btn-secondary mt-5 inline-flex">
              {t("backToBilling")}
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

export default function PayPalReturnPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-navy-500">…</div>}>
      <PayPalReturnInner />
    </Suspense>
  );
}
