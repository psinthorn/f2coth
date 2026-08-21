"use client";

import { use, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { Loader2, AlertTriangle, Lock } from "lucide-react";
import F2LogoMark from "@/components/F2LogoMark";
import { portalApi } from "@/lib/portal-api";

export default function MagicLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const t = useTranslations("portal.magic");
  const tl = useTranslations("portal.login");
  const router = useRouter();
  const [state, setState] = useState<"verifying" | "error">("verifying");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // StrictMode / re-render guard — token is single-use
    ran.current = true;
    portalApi.magicLinkVerify(token)
      .then((res) => {
        if (res.mfaRequired) { setMfaToken(res.mfaToken ?? null); return; }
        router.push("/portal");
      })
      .catch(() => setState("error"));
  }, [token, router]);

  async function submitMfa(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaToken) return;
    setBusy(true); setErr("");
    try {
      await portalApi.mfaVerify(mfaToken, useRecovery ? { recovery_code: mfaCode.trim() } : { code: mfaCode.trim() });
      router.push("/portal");
    } catch {
      setErr(tl("mfa.invalid"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-navy-50 grid place-items-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <span className="inline-flex items-center gap-2"><F2LogoMark className="h-10 w-10 rounded-lg" /><span className="font-display text-xl text-navy-900">{tl("brandTitle")}</span></span>
        </div>

        {mfaToken ? (
          <form onSubmit={submitMfa} className="card space-y-4">
            <div className="flex items-center gap-2 text-navy-700"><Lock className="h-4 w-4" /><h1 className="font-display text-xl text-navy-900">{tl("mfa.title")}</h1></div>
            <p className="text-sm text-navy-600">{useRecovery ? tl("mfa.recoveryHint") : tl("mfa.hint")}</p>
            <input autoFocus inputMode={useRecovery ? "text" : "numeric"} value={mfaCode} onChange={(e) => setMfaCode(e.target.value)}
              placeholder={useRecovery ? tl("mfa.recoveryPlaceholder") : "••••••"}
              className="w-full rounded-lg border border-navy-200 px-3 py-2 text-center text-lg tracking-widest focus:border-accent-500 focus:outline-none" />
            {err && <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4" /><span>{err}</span></div>}
            <button type="submit" disabled={busy || !mfaCode.trim()} className="btn-accent w-full disabled:opacity-50">{busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {tl("submitting")}</> : tl("mfa.verify")}</button>
            <p className="text-center text-xs text-navy-500"><button type="button" onClick={() => { setUseRecovery((v) => !v); setMfaCode(""); setErr(""); }} className="hover:text-accent-700 underline-offset-2 hover:underline">{useRecovery ? tl("mfa.useApp") : tl("mfa.useRecovery")}</button></p>
          </form>
        ) : state === "verifying" ? (
          <div className="card flex items-center justify-center gap-2 py-10 text-navy-500"><Loader2 className="h-5 w-5 animate-spin" /> {t("verifying")}</div>
        ) : (
          <div className="card space-y-3 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-red-50 text-red-600"><AlertTriangle className="h-6 w-6" /></span>
            <h1 className="font-display text-xl text-navy-900">{t("expiredTitle")}</h1>
            <p className="text-sm text-navy-600">{t("expiredBody")}</p>
            <Link href="/portal/login" className="btn-accent inline-flex">{t("backToLogin")}</Link>
          </div>
        )}
      </div>
    </div>
  );
}
