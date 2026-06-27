"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

const REQUEST_TYPES = ["access", "rectification", "erasure", "portability", "objection", "restrict"] as const;

export default function DSRForm({ locale }: { locale: string }) {
  const t = useTranslations("privacy.dsr");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [form, setForm] = useState({
    requesterName: "",
    requesterEmail: "",
    requestType: "access",
    description: "",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    try {
      const res = await fetch("/api/privacy/dsr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requester_name: form.requesterName,
          requester_email: form.requesterEmail,
          request_type: form.requestType,
          description: form.description,
          locale,
        }),
      });
      if (!res.ok) throw new Error("failed");
      setStatus("success");
    } catch {
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-6 text-blue-900" role="status">
        <p className="font-semibold">{t("successTitle")}</p>
        <p className="text-sm mt-1">{t("successBody")}</p>
        <p className="text-xs mt-3 text-blue-700">{t("successHint")}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-4 rounded-xl border border-slate-200 p-6">
      <div>
        <label htmlFor="dsr-name" className="block text-sm font-medium text-slate-700">
          {t("nameLabel")} <span aria-hidden="true">*</span>
        </label>
        <input
          id="dsr-name"
          type="text"
          required
          value={form.requesterName}
          onChange={(e) => setForm({ ...form, requesterName: e.target.value })}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
        />
      </div>

      <div>
        <label htmlFor="dsr-email" className="block text-sm font-medium text-slate-700">
          {t("emailLabel")} <span aria-hidden="true">*</span>
        </label>
        <input
          id="dsr-email"
          type="email"
          required
          value={form.requesterEmail}
          onChange={(e) => setForm({ ...form, requesterEmail: e.target.value })}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
        />
      </div>

      <div>
        <label htmlFor="dsr-type" className="block text-sm font-medium text-slate-700">
          {t("typeLabel")} <span aria-hidden="true">*</span>
        </label>
        <select
          id="dsr-type"
          required
          value={form.requestType}
          onChange={(e) => setForm({ ...form, requestType: e.target.value })}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
        >
          {REQUEST_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`type_${type}`)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="dsr-desc" className="block text-sm font-medium text-slate-700">
          {t("descLabel")}
        </label>
        <textarea
          id="dsr-desc"
          rows={4}
          maxLength={2000}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
        />
      </div>

      {status === "error" && (
        <p className="text-red-600 text-sm">{t("errorMsg")}</p>
      )}

      <button
        type="submit"
        disabled={status === "submitting"}
        className="btn-accent w-full disabled:opacity-60"
      >
        {status === "submitting" ? t("submitting") : t("submit")}
      </button>

      <p className="text-xs text-slate-500">{t("disclaimer")}</p>
    </form>
  );
}
