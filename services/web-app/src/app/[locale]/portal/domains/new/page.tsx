"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import {
  Search, Loader2, ArrowLeft, ArrowRight, ShieldCheck, CheckCircle2,
  AlertTriangle, Info, X,
} from "lucide-react";
import PortalShell from "@/components/PortalShell";
import {
  portalApi, type AvailabilityResult, type NewPortalDomainOrder,
} from "@/lib/portal-api";

const DEFAULT_TLDS = ["com", "net", "co.th", "or.th", "in.th"];

type Step = "search" | "results" | "form" | "done";

type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "submitting" }
  | { kind: "err"; msg: string };

export default function PortalNewDomainOrderPage() {
  const t = useTranslations("portal.domainsNew");
  const ts = useTranslations("domains.status");
  const tc = useTranslations("common");

  const [step, setStep] = useState<Step>("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AvailabilityResult[]>([]);
  const [selected, setSelected] = useState<AvailabilityResult | null>(null);
  const [form, setForm] = useState<Omit<NewPortalDomainOrder, "sld" | "tld" | "registry">>({
    contact_name: "",
    contact_email: "",
    contact_phone: "",
    contact_company: "",
    years: 1,
    privacy_enabled: true,
    notes: "",
  });
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const cleanedSLD = useMemo(() => sanitizeSLD(query), [query]);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    if (!cleanedSLD) {
      setStatus({ kind: "err", msg: t("errorSearchRequired") });
      return;
    }
    setStatus({ kind: "checking" });
    try {
      const data = await portalApi.checkAvailability(cleanedSLD, DEFAULT_TLDS);
      setResults(data.results ?? []);
      setStep("results");
      setStatus({ kind: "idle" });
    } catch {
      setStatus({ kind: "err", msg: t("errorCheckFailed") });
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    if (!form.contact_name.trim() || !form.contact_email.trim()) {
      setStatus({ kind: "err", msg: t("errorContactRequired") });
      return;
    }
    setStatus({ kind: "submitting" });
    try {
      const registry: "thnic" | "resellerclub" =
        selected.classification === "manual" ? "thnic" : "resellerclub";
      await portalApi.createDomainOrder({
        sld: cleanedSLD,
        tld: selected.tld,
        registry,
        contact_name: form.contact_name.trim(),
        contact_email: form.contact_email.trim(),
        contact_phone: form.contact_phone?.trim() || undefined,
        contact_company: form.contact_company?.trim() || undefined,
        years: form.years,
        privacy_enabled: form.privacy_enabled,
        notes: form.notes?.trim() || undefined,
      });
      setStep("done");
      setStatus({ kind: "idle" });
    } catch (e: any) {
      setStatus({ kind: "err", msg: e?.body ?? e?.message ?? t("errorSubmitFailed") });
    }
  }

  function reset() {
    setStep("search");
    setResults([]);
    setSelected(null);
    setStatus({ kind: "idle" });
  }

  function pickTLD(r: AvailabilityResult) {
    if (r.classification === "registered") return;
    setSelected(r);
    setStep("form");
  }

  return (
    <PortalShell>
      <Link href="/portal/domains" className="inline-flex items-center gap-1 text-sm text-navy-600 hover:text-accent-700">
        <ArrowLeft className="h-3.5 w-3.5" /> {t("back")}
      </Link>

      <header className="mt-3 mb-6">
        <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-navy-600">{t("subtitle")}</p>
      </header>

      {/* STEP: search */}
      {step === "search" && (
        <form onSubmit={check} className="card max-w-3xl space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-navy-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("searchPlaceholder")}
                className="w-full rounded-lg border border-navy-200 pl-9 pr-3 py-2.5 text-sm focus:border-accent-500 focus:outline-none"
              />
            </div>
            <button type="submit" disabled={status.kind === "checking"} className="btn-accent">
              {status.kind === "checking" ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> {t("checking")}</>
              ) : (
                <>{t("checkButton")} <ArrowRight className="h-4 w-4" /></>
              )}
            </button>
          </div>
          {status.kind === "err" && (
            <ErrorBanner msg={status.msg} />
          )}
        </form>
      )}

      {/* STEP: results */}
      {step === "results" && (
        <div className="card max-w-3xl space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl text-navy-900">
              {t("resultsTitle", { sld: cleanedSLD })}
            </h2>
            <button onClick={reset} className="inline-flex items-center gap-1 text-xs text-navy-500 hover:text-navy-900">
              <X className="h-3 w-3" /> {t("checkAgain")}
            </button>
          </div>
          <ul className="divide-y divide-navy-100">
            {results.map((r) => (
              <li key={r.fqdn} className="flex items-center justify-between gap-3 py-3">
                <span className="font-medium text-navy-900">{r.fqdn}</span>
                <div className="flex items-center gap-2">
                  <ClassificationBadge classification={r.classification} label={ts(r.classification)} />
                  <button
                    onClick={() => pickTLD(r)}
                    disabled={r.classification === "registered"}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                      r.classification === "registered"
                        ? "bg-navy-100 text-navy-400 cursor-not-allowed"
                        : "bg-accent-600 text-white hover:bg-accent-700"
                    }`}
                  >
                    {t("selectButton")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {results.some((r) => r.classification === "manual") && (
            <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{ts("manualHint")}</span>
            </p>
          )}
        </div>
      )}

      {/* STEP: form */}
      {step === "form" && selected && (
        <form onSubmit={submit} className="card max-w-3xl space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wider text-navy-500">{t("orderingTitle")}</p>
              <p className="font-display text-2xl text-navy-900">{cleanedSLD}.{selected.tld}</p>
            </div>
            <button type="button" onClick={() => setStep("results")} className="text-xs text-navy-500 hover:text-navy-900">
              {t("changeDomain")}
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("fields.name")} value={form.contact_name}
                   onChange={(v) => setForm({ ...form, contact_name: v })} required />
            <Field label={t("fields.email")} type="email" value={form.contact_email}
                   onChange={(v) => setForm({ ...form, contact_email: v })} required />
            <Field label={t("fields.phone")} value={form.contact_phone ?? ""}
                   onChange={(v) => setForm({ ...form, contact_phone: v })} />
            <Field label={t("fields.company")} value={form.contact_company ?? ""}
                   onChange={(v) => setForm({ ...form, contact_company: v })} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-navy-700">{t("fields.years")}</label>
              <input
                type="number" min={1} max={10}
                value={form.years}
                onChange={(e) => setForm({ ...form, years: Math.max(1, parseInt(e.target.value) || 1) })}
                className="rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
              />
            </div>
            <label className="mt-5 flex items-center gap-2 text-sm text-navy-800">
              <input
                type="checkbox"
                checked={form.privacy_enabled}
                onChange={(e) => setForm({ ...form, privacy_enabled: e.target.checked })}
              />
              <ShieldCheck className="h-4 w-4 text-accent-700" /> {t("fields.privacy")}
            </label>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-navy-700">{t("fields.notes")}</label>
            <textarea
              value={form.notes ?? ""}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
              placeholder={t("fields.notesPlaceholder")}
              className="rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
            />
          </div>

          {selected.classification === "manual" && (
            <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{t("manualNotice")}</span>
            </p>
          )}

          {status.kind === "err" && <ErrorBanner msg={status.msg} />}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setStep("results")} className="rounded-lg px-4 py-2 text-sm text-navy-700 hover:bg-navy-50">
              {tc("cancel")}
            </button>
            <button type="submit" disabled={status.kind === "submitting"} className="btn-accent">
              {status.kind === "submitting" ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> {tc("saving")}</>
              ) : (
                <>{t("submitOrder")} <ArrowRight className="h-4 w-4" /></>
              )}
            </button>
          </div>
        </form>
      )}

      {/* STEP: done */}
      {step === "done" && (
        <div className="card max-w-2xl">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-1 h-7 w-7 text-emerald-600" />
            <div className="flex-1">
              <h2 className="font-display text-2xl text-navy-900">{t("doneTitle")}</h2>
              <p className="mt-2 text-sm text-navy-600">{t("doneBody")}</p>
              <div className="mt-5 flex gap-2">
                <Link href="/portal/domains" className="btn-accent">
                  {t("backToDomains")}
                </Link>
                <button onClick={reset} className="rounded-lg border border-navy-200 px-4 py-2 text-sm text-navy-700 hover:bg-navy-50">
                  {t("orderAnother")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </PortalShell>
  );
}

function ClassificationBadge({
  classification, label,
}: {
  classification: AvailabilityResult["classification"];
  label: string;
}) {
  const cls =
    classification === "available" ? "bg-emerald-50 text-emerald-800" :
    classification === "registered" ? "bg-red-50 text-red-700" :
    classification === "premium" ? "bg-violet-50 text-violet-800" :
    classification === "manual" ? "bg-amber-50 text-amber-800" :
    "bg-navy-100 text-navy-700";
  return <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${cls}`}>{label}</span>;
}

function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
      <AlertTriangle className="mt-0.5 h-4 w-4" />
      <span>{msg}</span>
    </div>
  );
}

function Field({
  label, value, onChange, type = "text", required,
}: { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-navy-700">{label}{required && " *"}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
      />
    </div>
  );
}

function sanitizeSLD(s: string): string {
  let v = s.toLowerCase().trim().replace(/^\.+|\.+$/g, "");
  if (v.includes(".")) v = v.split(".")[0];
  return /^[a-z0-9-]+$/.test(v) && v.length > 0 ? v : "";
}
