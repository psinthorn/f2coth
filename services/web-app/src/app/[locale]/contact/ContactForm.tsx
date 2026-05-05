"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import type { ServiceItem } from "@/lib/api";

type Status = { kind: "idle" } | { kind: "submitting" } | { kind: "ok" } | { kind: "err"; msg: string };

const moduleNames: Record<string, string> = {
  "tour-operator": "Tour Operator",
  "transfer-service": "Transfer Service",
  "ecommerce-web-templates": "E-commerce & Web Templates",
};

export default function ContactForm({
  services,
  preselectedService,
  preselectedModule,
}: {
  services: ServiceItem[];
  preselectedService?: string;
  preselectedModule?: string;
}) {
  const t = useTranslations("contact.form");
  const locale = useLocale();

  const propertyTypes = [
    { value: "", label: t("propertyTypes.select") },
    { value: "hotel", label: t("propertyTypes.hotel") },
    { value: "resort", label: t("propertyTypes.resort") },
    { value: "villa", label: t("propertyTypes.villa") },
    { value: "restaurant", label: t("propertyTypes.restaurant") },
    { value: "other", label: t("propertyTypes.other") },
  ];

  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [interest, setInterest] = useState<string[]>(
    preselectedService ? [preselectedService] : [],
  );

  const moduleLabel = preselectedModule ? moduleNames[preselectedModule] : undefined;
  const defaultMessage = moduleLabel
    ? t("moduleInterestPrefill", { module: moduleLabel })
    : "";

  function toggleInterest(slug: string) {
    setInterest((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug],
    );
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus({ kind: "submitting" });
    const fd = new FormData(e.currentTarget);

    const body = {
      full_name: String(fd.get("full_name") || "").trim(),
      email: String(fd.get("email") || "").trim(),
      phone: String(fd.get("phone") || "").trim(),
      company: String(fd.get("company") || "").trim(),
      property_name: String(fd.get("property_name") || "").trim(),
      property_type: String(fd.get("property_type") || "").trim(),
      message: String(fd.get("message") || "").trim(),
      source: "contact_form",
      interest,
      website: String(fd.get("website") || ""),
      locale,
    };

    if (!body.full_name || !body.email || !body.message) {
      setStatus({ kind: "err", msg: t("errorRequired") });
      return;
    }

    try {
      const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "/api";
      const res = await fetch(`${apiBase}/leads/`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept-Language": locale },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(String(res.status));
      setStatus({ kind: "ok" });
      e.currentTarget.reset();
      setInterest([]);
    } catch {
      setStatus({ kind: "err", msg: t("errorGeneric") });
    }
  }

  if (status.kind === "ok") {
    return (
      <div className="card">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-6 w-6 text-emerald-600" />
          <div>
            <h2 className="font-display text-2xl text-navy-900">{t("successTitle")}</h2>
            <p className="mt-2 text-navy-600">{t("successBody")}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-5">
      <input type="text" name="website" autoComplete="off" tabIndex={-1}
             aria-hidden className="hidden" defaultValue="" />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="full_name" label={t("fullName")} required />
        <Field name="email" label={t("email")} type="email" required />
        <Field name="phone" label={t("phone")} type="tel" />
        <Field name="company" label={t("company")} />
        <Field name="property_name" label={t("propertyName")} placeholder={t("propertyNamePlaceholder")} />
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-navy-800">{t("propertyType")}</label>
          <select
            name="property_type"
            defaultValue=""
            className="rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
          >
            {propertyTypes.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <p className="text-sm font-medium text-navy-800">{t("interestPrompt")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {services.map((s) => {
            const on = interest.includes(s.slug);
            return (
              <button
                key={s.slug}
                type="button"
                onClick={() => toggleInterest(s.slug)}
                className={`rounded-full border px-3 py-1.5 text-xs transition ${
                  on
                    ? "border-accent-600 bg-accent-50 text-accent-800"
                    : "border-navy-200 text-navy-700 hover:bg-navy-50"
                }`}
              >
                {s.title}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-navy-800">{t("message")}</label>
        <textarea
          name="message"
          rows={5}
          required
          maxLength={5000}
          defaultValue={defaultMessage}
          placeholder={t("messagePlaceholder")}
          className="rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
        />
      </div>

      {status.kind === "err" && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4" />
          <span>{status.msg}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={status.kind === "submitting"}
        className="btn-accent w-full sm:w-auto"
      >
        {status.kind === "submitting" ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> {t("submitting")}
          </>
        ) : (
          t("submit")
        )}
      </button>

      <p className="text-xs text-navy-500">
        {t("privacyNotice")}
        <a href={locale === "th" ? "/th/privacy" : "/privacy"} className="underline hover:text-accent-700">{t("privacyLink")}</a>.
      </p>
    </form>
  );
}

function Field({
  name, label, type = "text", required, placeholder,
}: { name: string; label: string; type?: string; required?: boolean; placeholder?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={name} className="text-sm font-medium text-navy-800">{label}</label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        className="rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
      />
    </div>
  );
}
