"use client";

import F2LogoMark from "@/components/F2LogoMark";
import { Suspense, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { useSearchParams } from "next/navigation";
import { Loader2, AlertTriangle, Lock } from "lucide-react";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useBusyAction } from "@/lib/toast";
import { adminApi } from "@/lib/admin-api";

export default function AdminLoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-navy-50" />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const t = useTranslations("admin.login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { busy, run } = useBusyAction();
  const [err, setErr] = useState("");
  const router = useRouter();
  const locale = useLocale();
  const searchParams = useSearchParams();
  const next = searchParams?.get("next") ?? "/admin";

  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);

  const goNext = () => {
    const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/admin";
    router.push(stripLocalePrefix(safeNext, locale) as any);
  };

  async function submitMfa(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaToken) return;
    setErr("");
    const ok = await run(async () => {
      await adminApi.mfaVerify(mfaToken, useRecovery ? { recovery_code: mfaCode.trim() } : { code: mfaCode.trim() });
    });
    if (ok) goNext(); else setErr(t("mfa.invalid"));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    // No success toast — a successful login navigates away. `run` still guards
    // against double-submit and toasts any failure; keep the inline error too.
    let mfaNeeded: string | null = null;
    const ok = await run(async () => {
      const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "/api";
      const res = await fetch(`${apiBase}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || String(res.status));
      }
      const data = await res.json();
      if (data.mfa_required) { mfaNeeded = data.mfa_token; return; }
      sessionStorage.setItem("f2_access_token", data.access_token);
      sessionStorage.setItem("f2_refresh_token", data.refresh_token);
      if (data.user) sessionStorage.setItem("f2_user", JSON.stringify(data.user));
    });
    if (ok && mfaNeeded) { setMfaToken(mfaNeeded); return; } // show the 2FA step
    if (ok) {
      const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/admin";
      // The i18n router auto-prepends the current locale, so strip any
      // explicit locale segment from `next` before pushing — otherwise
      // /th/admin becomes /th/th/admin.
      router.push(stripLocalePrefix(safeNext, locale) as any);
    } else {
      setErr(t("error"));
    }
  }

  return (
    <div className="min-h-screen bg-navy-50 grid place-items-center p-4">
      <div className="absolute top-4 right-4"><LanguageSwitcher /></div>
      {mfaToken ? (
        <form onSubmit={submitMfa} className="w-full max-w-md">
          <div className="mb-6 text-center">
            <span className="font-display text-xl text-navy-900">{t("brandTitle")}</span>
          </div>
          <div className="card space-y-4">
            <div className="flex items-center gap-2 text-navy-700">
              <Lock className="h-4 w-4" />
              <h1 className="font-display text-xl text-navy-900">{t("mfa.title")}</h1>
            </div>
            <p className="text-sm text-navy-600">{useRecovery ? t("mfa.recoveryHint") : t("mfa.hint")}</p>
            <input
              autoFocus inputMode={useRecovery ? "text" : "numeric"} value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              placeholder={useRecovery ? t("mfa.recoveryPlaceholder") : "••••••"}
              className="w-full rounded-lg border border-navy-200 px-3 py-2 text-center text-lg tracking-widest focus:border-accent-500 focus:outline-none"
            />
            {err && (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
                <AlertTriangle className="mt-0.5 h-4 w-4" /><span>{err}</span>
              </div>
            )}
            <button type="submit" disabled={busy || !mfaCode.trim()} className="btn-primary w-full disabled:opacity-40">
              {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("submitting")}</> : t("mfa.verify")}
            </button>
            <p className="text-center text-xs text-navy-500">
              <button type="button" onClick={() => { setUseRecovery((v) => !v); setMfaCode(""); setErr(""); }} className="hover:text-accent-700 underline-offset-2 hover:underline">
                {useRecovery ? t("mfa.useApp") : t("mfa.useRecovery")}
              </button>
            </p>
          </div>
        </form>
      ) : (
      <form onSubmit={onSubmit} className="w-full max-w-md">
        <div className="mb-6 text-center">
          <Link href="/" className="inline-flex items-center gap-2">
            <F2LogoMark className="h-10 w-10 rounded-lg" />
            <span className="font-display text-xl text-navy-900">{t("brandTitle")}</span>
          </Link>
        </div>

        <div className="card space-y-4">
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
          <button type="submit" disabled={busy} className="btn-primary w-full disabled:opacity-40">
            {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("submitting")}</> : t("submit")}
          </button>
          <p className="text-center text-xs text-navy-500">
            <Link href={"/admin/login/forgot" as any} className="hover:text-accent-700">{t("forgotPassword")}</Link>
            <span className="mx-2">·</span>
            <Link href="/" className="hover:text-accent-700">{t("back")}</Link>
          </p>
        </div>
      </form>
      )}
    </div>
  );
}

function stripLocalePrefix(path: string, locale: string): string {
  const prefix = `/${locale}`;
  if (path === prefix) return "/";
  if (path.startsWith(prefix + "/")) return path.slice(prefix.length);
  return path;
}
