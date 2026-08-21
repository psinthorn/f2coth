"use client";

import F2LogoMark from "@/components/F2LogoMark";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Loader2, AlertTriangle, Building2, MailCheck } from "lucide-react";
import { portalApi } from "@/lib/portal-api";
import LanguageSwitcher from "@/components/LanguageSwitcher";

export default function RegisterPage() {
  const t = useTranslations("portal.register");
  const [company, setCompany] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      await portalApi.register({ company_name: company.trim(), full_name: name.trim(), email: email.trim(), password });
      setDone(true);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : t("error"));
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

        {done ? (
          <div className="card space-y-3 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-50 text-emerald-700"><MailCheck className="h-6 w-6" /></span>
            <h1 className="font-display text-xl text-navy-900">{t("sentTitle")}</h1>
            <p className="text-sm text-navy-600">{t("sentBody", { email: email.trim() })}</p>
            <Link href="/portal/login" className="btn-accent inline-flex">{t("toLogin")}</Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="card space-y-4">
            <div className="flex items-center gap-2 text-navy-700">
              <Building2 className="h-4 w-4" />
              <h1 className="font-display text-xl text-navy-900">{t("heading")}</h1>
            </div>
            <p className="text-sm text-navy-600">{t("subtitle")}</p>

            <Field label={t("company")} value={company} onChange={setCompany} autoComplete="organization" required />
            <Field label={t("name")} value={name} onChange={setName} autoComplete="name" required />
            <Field label={t("email")} value={email} onChange={setEmail} type="email" autoComplete="email" required />
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-navy-800">{t("password")}</label>
              <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password" minLength={10}
                className="rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none" />
              <p className="text-xs text-navy-400">{t("passwordHint")}</p>
            </div>

            {err && (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
                <AlertTriangle className="mt-0.5 h-4 w-4" /><span>{err}</span>
              </div>
            )}
            <button type="submit" disabled={busy} className="btn-accent w-full">
              {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("submitting")}</> : t("submit")}
            </button>
            <p className="text-center text-xs text-navy-500">
              {t("haveAccount")}{" "}
              <Link href="/portal/login" className="text-accent-700 hover:underline">{t("signIn")}</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", autoComplete, required }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; autoComplete?: string; required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-navy-800">{label}</label>
      <input type={type} required={required} value={value} autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none" />
    </div>
  );
}
