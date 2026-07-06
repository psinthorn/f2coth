"use client";

import F2LogoMark from "@/components/F2LogoMark";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Loader2, AlertTriangle, KeyRound } from "lucide-react";
import LanguageSwitcher from "@/components/LanguageSwitcher";

export default function PortalForgotPasswordPage() {
  const t = useTranslations("portal.login.forgot");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "/api";
      const res = await fetch(`${apiBase}/auth/customer/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok && res.status >= 500) throw new Error("server error");
      setSent(true);
    } catch {
      setErr(t("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-navy-50 grid place-items-center p-4">
      <div className="absolute top-4 right-4"><LanguageSwitcher /></div>
      <form onSubmit={onSubmit} className="w-full max-w-md">
        <div className="mb-6 text-center">
          <span className="grid h-10 w-10 place-items-center mx-auto rounded-lg bg-navy-900 text-white"><F2LogoMark className="h-6 w-6" /></span>
        </div>
        <div className="card space-y-4">
          <div className="flex items-center gap-2 text-navy-700">
            <KeyRound className="h-4 w-4" />
            <h1 className="font-display text-xl text-navy-900">{t("heading")}</h1>
          </div>
          {sent ? (
            <p className="text-sm text-navy-700">{t("sent")}</p>
          ) : (
            <>
              <p className="text-sm text-navy-600">{t("instructions")}</p>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-navy-800">{t("email")}</label>
                <input
                  type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  className="rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
                />
              </div>
              {err && (
                <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4" /><span>{err}</span>
                </div>
              )}
              <button type="submit" disabled={busy} className="btn-accent w-full">
                {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("submitting")}</> : t("submit")}
              </button>
            </>
          )}
          <p className="text-center text-xs text-navy-500">
            <Link href={"/portal/login" as any} className="hover:text-accent-700">{t("backToLogin")}</Link>
          </p>
        </div>
      </form>
    </div>
  );
}
