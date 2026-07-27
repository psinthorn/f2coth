"use client";

import F2LogoMark from "@/components/F2LogoMark";
import { use, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Loader2, AlertTriangle, MailCheck, CheckCircle2 } from "lucide-react";
import LanguageSwitcher from "@/components/LanguageSwitcher";

type State = "verifying" | "ok" | "error";

export default function PortalVerifyEmailPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const t = useTranslations("portal.verifyEmail");
  const [state, setState] = useState<State>("verifying");
  const ran = useRef(false);

  useEffect(() => {
    // Guard against React 18 StrictMode double-invoke consuming the token twice.
    if (ran.current) return;
    ran.current = true;
    (async () => {
      try {
        const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "/api";
        const res = await fetch(`${apiBase}/auth/customer/verify-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        setState(res.ok ? "ok" : "error");
      } catch {
        setState("error");
      }
    })();
  }, [token]);

  return (
    <div className="min-h-screen bg-navy-50 grid place-items-center p-4">
      <div className="absolute top-4 right-4"><LanguageSwitcher /></div>
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <F2LogoMark className="h-10 w-10 rounded-lg mx-auto" />
        </div>
        <div className="card space-y-4">
          <div className="flex items-center gap-2 text-navy-700">
            <MailCheck className="h-4 w-4" />
            <h1 className="font-display text-xl text-navy-900">{t("heading")}</h1>
          </div>

          {state === "verifying" && (
            <div className="flex items-center gap-2 text-navy-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              <p className="text-sm">{t("verifying")}</p>
            </div>
          )}

          {state === "ok" && (
            <>
              <div className="flex items-center gap-2 text-emerald-800">
                <CheckCircle2 className="h-4 w-4" />
                <p className="text-sm">{t("success")}</p>
              </div>
              <Link href={"/portal/login" as any} className="btn-accent text-sm">{t("goToLogin")}</Link>
            </>
          )}

          {state === "error" && (
            <>
              <div className="flex items-center gap-2 text-red-700">
                <AlertTriangle className="h-4 w-4" />
                <p className="text-sm">{t("error")}</p>
              </div>
              <Link href={"/portal/login" as any} className="text-sm text-accent-600 hover:underline">
                {t("requestNew")}
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
