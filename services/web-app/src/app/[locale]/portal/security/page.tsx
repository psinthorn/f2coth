"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, ShieldCheck, ShieldOff, KeyRound, Copy, Check } from "lucide-react";
import PortalShell from "@/components/PortalShell";
import { toast, useBusyAction } from "@/lib/toast";
import { portalApi } from "@/lib/portal-api";

export default function PortalSecurityPage() {
  return (
    <PortalShell>
      <SecurityView />
    </PortalShell>
  );
}

type Step = "idle" | "enroll" | "recovery";

function SecurityView() {
  const t = useTranslations("portal.security");
  const tc = useTranslations("common");
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [secret, setSecret] = useState("");
  const [otpauth, setOtpauth] = useState("");
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[]>([]);
  const [disableCode, setDisableCode] = useState("");
  const { busy, run } = useBusyAction();

  const load = useCallback(async () => {
    const me = await portalApi.me();
    setEnabled(!!me.contact.mfa_enabled);
  }, []);
  useEffect(() => { load().catch(() => setEnabled(false)); }, [load]);

  const startEnroll = async () => {
    const ok = await run(async () => {
      const s = await portalApi.mfaSetup();
      setSecret(s.secret); setOtpauth(s.otpauth_uri); setStep("enroll");
    });
    if (!ok) toast.error(tc("toast.error"));
  };

  const confirmEnroll = async () => {
    const ok = await run(async () => {
      const r = await portalApi.mfaEnable(code.trim());
      setRecovery(r.recovery_codes); setStep("recovery"); setEnabled(true); setCode("");
    }, { success: t("enabledToast") });
    if (!ok) return;
  };

  const disable = async () => {
    if (!window.confirm(t("disableConfirm"))) return;
    const ok = await run(async () => { await portalApi.mfaDisable(disableCode.trim()); await load(); setStep("idle"); setDisableCode(""); }, { success: t("disabledToast") });
    if (ok) setEnabled(false);
  };

  if (enabled === null) {
    return <div className="flex items-center gap-2 text-navy-500"><Loader2 className="h-5 w-5 animate-spin" /> {tc("loading")}</div>;
  }

  return (
    <div className="max-w-2xl">
      <header className="mb-6">
        <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
        <p className="text-sm text-navy-600">{t("subtitle")}</p>
      </header>

      <div className="rounded-xl border border-navy-100 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${enabled ? "bg-emerald-50 text-emerald-700" : "bg-navy-50 text-navy-400"}`}>
            {enabled ? <ShieldCheck className="h-5 w-5" /> : <ShieldOff className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-navy-900">{t("mfaHeading")}</p>
            <p className="text-sm text-navy-600">{enabled ? t("statusOn") : t("statusOff")}</p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${enabled ? "bg-emerald-50 text-emerald-700" : "bg-navy-100 text-navy-600"}`}>
            {enabled ? t("on") : t("off")}
          </span>
        </div>

        {/* ── Not enrolled → enable ── */}
        {!enabled && step === "idle" && (
          <button onClick={startEnroll} disabled={busy} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} {t("enable")}
          </button>
        )}

        {/* ── Enroll: show secret + confirm a code ── */}
        {step === "enroll" && (
          <div className="mt-5 space-y-4 border-t border-navy-100 pt-4">
            <div>
              <p className="text-sm font-medium text-navy-800">{t("step1")}</p>
              <p className="mt-1 text-xs text-navy-500">{t("manualHint")}</p>
              <CopyBox label={t("secretLabel")} value={secret.replace(/(.{4})/g, "$1 ").trim()} copyValue={secret} />
              <a href={otpauth} className="mt-2 inline-block text-xs text-accent-600 underline underline-offset-2">{t("openInApp")}</a>
            </div>
            <div>
              <p className="text-sm font-medium text-navy-800">{t("step2")}</p>
              <div className="mt-2 flex gap-2">
                <input autoFocus inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="••••••"
                  className="w-40 rounded-lg border border-navy-200 px-3 py-2 text-center text-lg tracking-widest focus:border-accent-500 focus:outline-none" />
                <button onClick={confirmEnroll} disabled={busy || code.trim().length < 6} className="inline-flex items-center gap-1.5 rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {t("confirm")}
                </button>
                <button onClick={() => { setStep("idle"); setCode(""); }} disabled={busy} className="rounded-lg border border-navy-200 px-3 py-2 text-sm hover:bg-navy-50 disabled:opacity-50">{tc("cancel")}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Recovery codes (shown once) ── */}
        {step === "recovery" && (
          <div className="mt-5 space-y-3 border-t border-navy-100 pt-4">
            <div className="flex items-center gap-2 text-navy-800"><KeyRound className="h-4 w-4 text-accent-600" /><p className="font-medium">{t("recoveryTitle")}</p></div>
            <p className="text-xs text-navy-500">{t("recoveryHint")}</p>
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-navy-50 p-3 font-mono text-sm text-navy-800 sm:grid-cols-2">
              {recovery.map((c) => <span key={c}>{c}</span>)}
            </div>
            <div className="flex gap-2">
              <button onClick={() => { navigator.clipboard?.writeText(recovery.join("\n")); toast.success(tc("toast.copied")); }} className="inline-flex items-center gap-1.5 rounded-lg border border-navy-200 px-3 py-1.5 text-sm hover:bg-navy-50">
                <Copy className="h-4 w-4" /> {t("copyCodes")}
              </button>
              <button onClick={() => setStep("idle")} className="rounded-lg bg-accent-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-700">{t("done")}</button>
            </div>
          </div>
        )}

        {/* ── Enrolled → disable ── */}
        {enabled && step === "idle" && (
          <div className="mt-5 flex flex-wrap items-end gap-2 border-t border-navy-100 pt-4">
            <div>
              <label className="text-xs font-medium text-navy-600">{t("disableLabel")}</label>
              <input inputMode="numeric" value={disableCode} onChange={(e) => setDisableCode(e.target.value)} placeholder="••••••"
                className="mt-1 block w-36 rounded-lg border border-navy-200 px-3 py-2 text-center tracking-widest focus:border-accent-500 focus:outline-none" />
            </div>
            <button onClick={disable} disabled={busy || disableCode.trim().length < 6} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 hover:bg-red-100 disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldOff className="h-4 w-4" />} {t("disable")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CopyBox({ label, value, copyValue }: { label: string; value: string; copyValue: string }) {
  const tc = useTranslations("common");
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2">
      <p className="text-xs text-navy-500">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="flex-1 rounded-lg bg-navy-50 px-3 py-2 font-mono text-sm tracking-wider text-navy-900">{value}</code>
        <button onClick={() => { navigator.clipboard?.writeText(copyValue); setCopied(true); toast.success(tc("toast.copied")); setTimeout(() => setCopied(false), 1500); }}
          className="rounded-lg border border-navy-200 p-2 text-navy-500 hover:bg-navy-50" aria-label={tc("copy")}>
          {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
