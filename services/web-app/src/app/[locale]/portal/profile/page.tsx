"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Loader2, Save, KeyRound, MailCheck, MailWarning } from "lucide-react";
import PortalShell from "@/components/PortalShell";
import { toast, useBusyAction } from "@/lib/toast";
import { portalApi, type PortalContact } from "@/lib/portal-api";

export default function PortalProfilePage() {
  const t = useTranslations("portal.profile");
  const { busy, run } = useBusyAction();
  const [contact, setContact] = useState<PortalContact | null>(null);
  const [loading, setLoading] = useState(true);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [jobTitle, setJobTitle] = useState("");

  useEffect(() => {
    portalApi.me()
      .then((d) => {
        setContact(d.contact);
        setFullName(d.contact.full_name ?? "");
        setPhone(d.contact.phone ?? "");
        setJobTitle(d.contact.job_title ?? "");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    // run() already toasts { success } — don't fire a second identical toast.
    await run(
      () => portalApi.updateProfile({
        full_name: fullName.trim(),
        phone: phone.trim(),
        job_title: jobTitle.trim(),
      }),
      { success: t("saved") },
    );
  }

  return (
    <PortalShell>
      <div className="mx-auto max-w-2xl">
        <h1 className="font-display text-2xl text-navy-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-navy-600">{t("subtitle")}</p>

        {loading || !contact ? (
          <div className="mt-8 grid place-items-center text-navy-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <>
            <div className="card mt-6 space-y-4">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-navy-800">{t("email")}</label>
                <div className="flex items-center gap-2">
                  <input value={contact.email} disabled
                    className="flex-1 rounded-lg border border-navy-200 bg-navy-50 px-3 py-2 text-sm text-navy-500" />
                  {contact.email_verified_at ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
                      <MailCheck className="h-3.5 w-3.5" /> {t("verified")}
                    </span>
                  ) : (
                    <button
                      onClick={() => portalApi.requestVerificationLink(contact.email).then(() => toast.success(t("verifySent"))).catch(() => {})}
                      className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-700 hover:bg-amber-100">
                      <MailWarning className="h-3.5 w-3.5" /> {t("verifyNow")}
                    </button>
                  )}
                </div>
              </div>

              <Field label={t("fullName")} value={fullName} onChange={setFullName} />
              <Field label={t("phone")} value={phone} onChange={setPhone} />
              <Field label={t("jobTitle")} value={jobTitle} onChange={setJobTitle} />

              <div className="flex justify-end">
                <button onClick={save} disabled={busy} className="btn-accent text-sm disabled:opacity-40">
                  {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("saving")}</> : <><Save className="h-4 w-4" /> {t("save")}</>}
                </button>
              </div>
            </div>

            <div className="card mt-6 flex items-center justify-between">
              <div className="flex items-center gap-2 text-navy-700">
                <KeyRound className="h-4 w-4" />
                <span className="text-sm font-medium">{t("password")}</span>
              </div>
              <Link href={"/portal/change-password" as any} className="btn-ghost text-sm">{t("changePassword")}</Link>
            </div>
          </>
        )}
      </div>
    </PortalShell>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-navy-800">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none" />
    </div>
  );
}
