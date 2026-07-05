"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Save, AlertCircle, CheckCircle2 } from "lucide-react";
import PortalShell from "@/components/PortalShell";
import { portalApi, type PortalBillingProfile, HttpError } from "@/lib/portal-api";

// Portal-side billing profile editor. Used so customers can enter their
// own tax-invoice data (เลขประจำตัวผู้เสียภาษี, branch code, address)
// without waiting for F2 staff to do it.
export default function PortalBillingProfilePage() {
  const t = useTranslations("portal.billingProfile");
  const tc = useTranslations("common");
  const [profile, setProfile] = useState<PortalBillingProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    portalApi.getBillingProfile()
      .then((p) => { setProfile(p); setLoaded(true); })
      .catch((e: unknown) => {
        if (e instanceof HttpError && e.status === 404) {
          setProfile({ legal_name: "", branch_code: "00000", country: "TH" });
        }
        setLoaded(true);
      });
  }, []);

  async function save() {
    if (!profile) return;
    if (!profile.legal_name.trim()) {
      setMsg({ kind: "err", text: t("legalNameRequired") });
      return;
    }
    setBusy(true); setMsg(null);
    try {
      setProfile(await portalApi.upsertBillingProfile(profile));
      setMsg({ kind: "ok", text: t("saved") });
    } catch (e: unknown) {
      const v = e as { body?: string };
      setMsg({ kind: "err", text: v.body || tc("error") });
    } finally {
      setBusy(false);
    }
  }

  if (!loaded || !profile) {
    return (
      <PortalShell>
        <div className="text-navy-500"><Loader2 className="inline h-4 w-4 animate-spin" /> {tc("loading")}</div>
      </PortalShell>
    );
  }

  const set = (patch: Partial<PortalBillingProfile>) => setProfile({ ...profile, ...patch });

  return (
    <PortalShell>
      <header className="mb-6">
        <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-navy-600">{t("subtitle")}</p>
      </header>

      <section className="card">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("legalName")} value={profile.legal_name} onChange={(v) => set({ legal_name: v })} required />
          <Field label={t("taxID")} value={profile.tax_id ?? ""} onChange={(v) => set({ tax_id: v })} placeholder="0105556012345" />
          <Field label={t("branchCode")} value={profile.branch_code} onChange={(v) => set({ branch_code: v })} placeholder="00000" />
          <Field label={t("billingEmail")} value={profile.billing_email ?? ""} onChange={(v) => set({ billing_email: v })} type="email" />
          <Field label={t("addressLine1")} value={profile.address_line1 ?? ""} onChange={(v) => set({ address_line1: v })} className="sm:col-span-2" />
          <Field label={t("addressLine2")} value={profile.address_line2 ?? ""} onChange={(v) => set({ address_line2: v })} className="sm:col-span-2" />
          <Field label={t("subdistrict")} value={profile.subdistrict ?? ""} onChange={(v) => set({ subdistrict: v })} />
          <Field label={t("district")} value={profile.district ?? ""} onChange={(v) => set({ district: v })} />
          <Field label={t("province")} value={profile.province ?? ""} onChange={(v) => set({ province: v })} />
          <Field label={t("postalCode")} value={profile.postal_code ?? ""} onChange={(v) => set({ postal_code: v })} />
          <Field label={t("country")} value={profile.country} onChange={(v) => set({ country: v })} />
        </div>
        {msg && (
          <p className={`mt-3 text-sm ${msg.kind === "ok" ? "text-emerald-700" : "text-red-700"} inline-flex items-center gap-1`}>
            {msg.kind === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            {msg.text}
          </p>
        )}
        <div className="mt-4 flex justify-end">
          <button type="button" className="btn-accent" disabled={busy} onClick={save}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {t("save")}
          </button>
        </div>
      </section>
    </PortalShell>
  );
}

function Field({
  label, value, onChange, type = "text", placeholder, required, className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <label className={`grid gap-1 text-xs text-navy-600 ${className ?? ""}`}>
      {label}{required && " *"}
      <input type={type} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-navy-200 px-3 py-2 text-sm" />
    </label>
  );
}
