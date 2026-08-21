"use client";

import F2LogoMark from "@/components/F2LogoMark";
import { Suspense, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { useSearchParams } from "next/navigation";
import { Loader2, AlertTriangle, Lock } from "lucide-react";
import { portalApi } from "@/lib/portal-api";
import { toast } from "@/lib/toast";
import LanguageSwitcher from "@/components/LanguageSwitcher";

export default function PortalLoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-navy-50" />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const t = useTranslations("portal.login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const router = useRouter();
  const locale = useLocale();
  const searchParams = useSearchParams();
  const next = searchParams?.get("next") ?? "/portal";

  // Second-factor step: set once password login reports mfa_required.
  const [remember, setRemember] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);

  const goNext = () => {
    const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/portal";
    router.push(stripLocalePrefix(safeNext, locale) as any);
  };

  async function submitMfa(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaToken) return;
    setBusy(true); setErr("");
    try {
      await portalApi.mfaVerify(mfaToken, useRecovery ? { recovery_code: mfaCode.trim() } : { code: mfaCode.trim() }, remember);
      goNext();
    } catch {
      setErr(t("mfa.invalid"));
    } finally {
      setBusy(false);
    }
  }

  // Self-service: re-send the email-verification link if the user lost it.
  // Enumeration-safe on the server (always 200), so the message is generic.
  async function requestVerifyLink() {
    if (!email.trim()) { setErr(t("needEmailForLink")); return; }
    setErr("");
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "/api";
      await fetch(`${apiBase}/auth/customer/request-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), purpose: "verification" }),
      });
      toast.success(t("linkSent"));
    } catch {
      toast.error(t("error"));
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const res = await portalApi.login(email, password, remember);
      if (res.mfaRequired) {
        setMfaToken(res.mfaToken ?? null);
        setBusy(false);
        return; // show the second-factor step
      }
      goNext();
    } catch {
      setErr(t("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-navy-50 grid place-items-center p-4">
      <div className="absolute top-4 right-4"><LanguageSwitcher /></div>
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <Link href="/" className="inline-flex items-center gap-2">
            <F2LogoMark className="h-10 w-10 rounded-lg" />
            <span className="font-display text-xl text-navy-900">{t("brandTitle")}</span>
          </Link>
        </div>

        {mfaToken ? (
          <form onSubmit={submitMfa} className="card space-y-4">
            <div className="flex items-center gap-2 text-navy-700">
              <Lock className="h-4 w-4" />
              <h1 className="font-display text-xl text-navy-900">{t("mfa.title")}</h1>
            </div>
            <p className="text-sm text-navy-600">{useRecovery ? t("mfa.recoveryHint") : t("mfa.hint")}</p>
            <input
              autoFocus
              inputMode={useRecovery ? "text" : "numeric"}
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              placeholder={useRecovery ? t("mfa.recoveryPlaceholder") : "••••••"}
              className="w-full rounded-lg border border-navy-200 px-3 py-2 text-center text-lg tracking-widest focus:border-accent-500 focus:outline-none"
            />
            {err && (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
                <AlertTriangle className="mt-0.5 h-4 w-4" /><span>{err}</span>
              </div>
            )}
            <button type="submit" disabled={busy || !mfaCode.trim()} className="btn-accent w-full disabled:opacity-50">
              {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("submitting")}</> : t("mfa.verify")}
            </button>
            <p className="text-center text-xs text-navy-500">
              <button type="button" onClick={() => { setUseRecovery((v) => !v); setMfaCode(""); setErr(""); }} className="hover:text-accent-700 underline-offset-2 hover:underline">
                {useRecovery ? t("mfa.useApp") : t("mfa.useRecovery")}
              </button>
            </p>
          </form>
        ) : (
          <form onSubmit={onSubmit} className="card space-y-4">
            <div className="flex items-center gap-2 text-navy-700">
              <Lock className="h-4 w-4" />
              <h1 className="font-display text-xl text-navy-900">{t("heading")}</h1>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-navy-800">{t("email")}</label>
              <input
                type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                className="rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-navy-800">{t("password")}</label>
              <input
                type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
              />
            </div>
            {err && (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
                <AlertTriangle className="mt-0.5 h-4 w-4" />
                <span>{err}</span>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm text-navy-700">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="rounded border-navy-300" />
              {t("rememberMe")}
            </label>
            <button type="submit" disabled={busy} className="btn-accent w-full">
              {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("submitting")}</> : t("submit")}
            </button>
            <p className="text-center text-xs text-navy-500">
              <Link href={"/portal/login/forgot" as any} className="hover:text-accent-700">{t("forgotPassword")}</Link>
              <span className="mx-2">·</span>
              <Link href="/" className="hover:text-accent-700">{t("back")}</Link>
            </p>
            <p className="text-center text-xs text-navy-500">
              <button type="button" onClick={requestVerifyLink} className="hover:text-accent-700 underline-offset-2 hover:underline">
                {t("resendVerification")}
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

function stripLocalePrefix(path: string, locale: string): string {
  const prefix = `/${locale}`;
  if (path === prefix) return "/";
  if (path.startsWith(prefix + "/")) return path.slice(prefix.length);
  return path;
}
