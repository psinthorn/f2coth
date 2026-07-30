"use client";

import F2LogoMark from "@/components/F2LogoMark";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { Loader2, AlertTriangle, KeyRound, CheckCircle2 } from "lucide-react";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { portalApi } from "@/lib/portal-api";
import { useBusyAction } from "@/lib/toast";

export default function PortalChangePasswordPage() {
  const t = useTranslations("portal.changePassword");
  const tc = useTranslations("common");
  const router = useRouter();
  const { busy, run } = useBusyAction();
  const [current, setCurrent] = useState("");
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pw1 !== pw2) { setErr(t("mismatch")); return; }
    setErr("");
    // run() already surfaces the server error as a toast on failure — don't
    // duplicate it with an inline banner.
    const done = await run(() => portalApi.changePassword(current, pw1), { success: tc("toast.done") });
    if (done) {
      setOk(true);
      // The server revokes all sessions on password change, so send the user
      // back to login to re-authenticate with the new password.
      setTimeout(() => router.push("/portal/login" as any), 1500);
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
              <p className="text-sm text-navy-600">{t("instructions")}</p>
              {err && (
                <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4" /><span>{err}</span>
                </div>
              )}
              <Field label={t("current")} value={current} onChange={setCurrent} />
              <Field label={t("new")} value={pw1} onChange={setPw1} />
              <Field label={t("confirm")} value={pw2} onChange={setPw2} />
              <button type="submit" disabled={busy} className="btn-accent w-full">
                {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("submitting")}</> : t("submit")}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-navy-800">{label}</label>
      <input type="password" value={value} onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none" />
    </div>
  );
}
