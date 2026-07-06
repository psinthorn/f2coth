"use client";

import F2LogoMark from "@/components/F2LogoMark";
import { use, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { Loader2, AlertTriangle, KeyRound, CheckCircle2 } from "lucide-react";
import LanguageSwitcher from "@/components/LanguageSwitcher";

export default function AdminResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const t = useTranslations("admin.login.reset");
  const router = useRouter();
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pw1 !== pw2) {
      setErr(t("mismatch"));
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "/api";
      const res = await fetch(`${apiBase}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: pw1 }),
      });
      if (!res.ok) {
        const body = await res.text();
        try {
          const parsed = JSON.parse(body) as { error?: string };
          throw new Error(parsed.error ?? body);
        } catch {
          throw new Error(body || String(res.status));
        }
      }
      setOk(true);
      setTimeout(() => router.push("/admin/login" as any), 1500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-navy-50 grid place-items-center p-4">
      <div className="absolute top-4 right-4"><LanguageSwitcher /></div>
      <form onSubmit={onSubmit} className="w-full max-w-md">
        <div className="mb-6 text-center">
          <F2LogoMark className="h-10 w-10 rounded-lg mx-auto" />
        </div>
        <div className="card space-y-4">
          <div className="flex items-center gap-2 text-navy-700">
            <KeyRound className="h-4 w-4" />
            <h1 className="font-display text-xl text-navy-900">{t("heading")}</h1>
          </div>
          {ok ? (
            <div className="flex items-center gap-2 text-emerald-800">
              <CheckCircle2 className="h-4 w-4" />
              <p className="text-sm">{t("success")}</p>
            </div>
          ) : (
            <>
              <p className="text-sm text-navy-600">{t("requirements")}</p>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-navy-800">{t("newPassword")}</label>
                <input
                  type="password" required minLength={10} value={pw1} onChange={(e) => setPw1(e.target.value)}
                  autoComplete="new-password"
                  className="rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-navy-800">{t("confirmPassword")}</label>
                <input
                  type="password" required minLength={10} value={pw2} onChange={(e) => setPw2(e.target.value)}
                  autoComplete="new-password"
                  className="rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
                />
              </div>
              {err && (
                <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4" /><span>{err}</span>
                </div>
              )}
              <button type="submit" disabled={busy} className="btn-primary w-full">
                {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("submitting")}</> : t("submit")}
              </button>
            </>
          )}
          <p className="text-center text-xs text-navy-500">
            <Link href={"/admin/login" as any} className="hover:text-accent-700">{t("backToLogin")}</Link>
          </p>
        </div>
      </form>
    </div>
  );
}
