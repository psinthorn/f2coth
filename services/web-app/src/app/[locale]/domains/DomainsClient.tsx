"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import {
  Search, ShieldCheck, Globe, Loader2, CheckCircle2, AlertTriangle, ArrowRight,
  Info, X,
} from "lucide-react";
import type { DomainPricingItem } from "@/lib/api";

type AvailabilityResult = {
  fqdn: string;
  tld: string;
  available: boolean;
  classification: "available" | "registered" | "reserved" | "premium" | "manual" | "unknown";
  source: string;
  cached: boolean;
};

type Step = "search" | "results";
type Status = { kind: "idle" } | { kind: "checking" } | { kind: "submitting" } | { kind: "ok" } | { kind: "err"; msg: string };

const DEFAULT_TLDS = ["com", "net", "co.th", "or.th", "in.th"];

export default function DomainsClient({ pricing }: { pricing: DomainPricingItem[] }) {
  const t = useTranslations("domains");
  const ts = useTranslations("domains.status");
  const locale = useLocale();

  const [query, setQuery] = useState("");
  const [step, setStep] = useState<Step>("search");
  const [availability, setAvailability] = useState<AvailabilityResult[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [contact, setContact] = useState({ name: "", email: "", company: "" });
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const cleanedSLD = useMemo(() => sanitizeSLD(query), [query]);

  const groups = useMemo(() => {
    const thnic = pricing.filter((p) => p.registry === "thnic");
    const rc = pricing.filter((p) => p.registry === "resellerclub");
    return { thnic, rc };
  }, [pricing]);

  async function checkAvailability(e: React.FormEvent) {
    e.preventDefault();
    if (!cleanedSLD) {
      setStatus({ kind: "err", msg: t("search.errorRequired") });
      return;
    }
    setStatus({ kind: "checking" });
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "/api";
      const res = await fetch(`${apiBase}/reseller/availability`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sld: cleanedSLD, tlds: DEFAULT_TLDS }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { results: AvailabilityResult[] };
      setAvailability(data.results ?? []);
      setSelected(new Set(data.results.filter((r) => r.available).map((r) => r.fqdn)));
      setStep("results");
      setStatus({ kind: "idle" });
    } catch {
      setStatus({ kind: "err", msg: t("search.errorRequired") });
    }
  }

  async function submitRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!contact.email.trim()) {
      setStatus({ kind: "err", msg: t("search.errorContact") });
      return;
    }
    setStatus({ kind: "submitting" });
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "/api";
      const tldList = selected.size > 0 ? Array.from(selected).join(", ") : DEFAULT_TLDS.map((t) => `${cleanedSLD}.${t}`).join(", ");
      const res = await fetch(`${apiBase}/leads/`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept-Language": locale },
        body: JSON.stringify({
          full_name: contact.name.trim() || "Domain inquiry",
          email: contact.email.trim(),
          company: contact.company.trim(),
          message: `Domain request: ${tldList}`,
          source: "domain_search",
          interest: ["cloud-infrastructure"],
          locale,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setStatus({ kind: "ok" });
    } catch {
      setStatus({ kind: "err", msg: t("search.errorRequired") });
    }
  }

  function reset() {
    setStep("search");
    setAvailability([]);
    setSelected(new Set());
    setStatus({ kind: "idle" });
  }

  function toggleSelect(fqdn: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(fqdn)) next.delete(fqdn);
      else next.add(fqdn);
      return next;
    });
  }

  return (
    <>
      <section className="bg-navy-50">
        <div className="container-page py-16">
          <p className="text-sm font-semibold uppercase tracking-wider text-accent-700">{t("hero.kicker")}</p>
          <h1 className="mt-2 font-display text-4xl text-navy-900 sm:text-5xl">{t("hero.title")}</h1>
          <p className="mt-4 max-w-2xl text-navy-600">{t("hero.subtitle")}</p>

          {step === "search" ? (
            <form onSubmit={checkAvailability} className="mt-8 card max-w-3xl space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-navy-400" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t("search.placeholder")}
                    className="w-full rounded-lg border border-navy-200 pl-9 pr-3 py-2.5 text-sm focus:border-accent-500 focus:outline-none"
                  />
                </div>
                <button type="submit" disabled={status.kind === "checking"} className="btn-accent">
                  {status.kind === "checking" ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> {t("search.checkingLive")}</>
                  ) : (
                    <>{t("search.button")} <ArrowRight className="h-4 w-4" /></>
                  )}
                </button>
              </div>
              {status.kind === "err" && (
                <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4" />
                  <span>{status.msg}</span>
                </div>
              )}
            </form>
          ) : (
            <div className="mt-8 card max-w-3xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-xl text-navy-900">
                  {t("search.resultsTitle", { sld: cleanedSLD })}
                </h3>
                <button onClick={reset} className="inline-flex items-center gap-1 text-xs text-navy-500 hover:text-navy-900">
                  <X className="h-3 w-3" /> {t("search.checkAgain")}
                </button>
              </div>

              <ul className="divide-y divide-navy-100">
                {availability.map((r) => (
                  <li key={r.fqdn} className="flex items-center justify-between gap-3 py-2.5">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selected.has(r.fqdn)}
                        disabled={r.classification === "registered"}
                        onChange={() => toggleSelect(r.fqdn)}
                      />
                      <span className="font-medium text-navy-900">{r.fqdn}</span>
                    </label>
                    <ClassificationBadge classification={r.classification} label={ts(r.classification)} />
                  </li>
                ))}
              </ul>

              {availability.some((r) => r.classification === "manual") && (
                <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
                  <Info className="mt-0.5 h-3.5 w-3.5" />
                  <span>{ts("manualHint")}</span>
                </p>
              )}

              <p className="text-xs text-navy-500">{t("search.selectedHint")}</p>

              {status.kind === "ok" ? (
                <div className="flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
                  <CheckCircle2 className="mt-0.5 h-4 w-4" />
                  <span>{t("search.thanks")}</span>
                </div>
              ) : (
                <form onSubmit={submitRequest} className="space-y-3 border-t border-navy-100 pt-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <input
                      type="text"
                      value={contact.name}
                      onChange={(e) => setContact({ ...contact, name: e.target.value })}
                      placeholder={t("form.namePlaceholder")}
                      className="rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
                    />
                    <input
                      type="email"
                      value={contact.email}
                      onChange={(e) => setContact({ ...contact, email: e.target.value })}
                      placeholder={t("form.emailPlaceholder")}
                      className="rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
                    />
                    <input
                      type="text"
                      value={contact.company}
                      onChange={(e) => setContact({ ...contact, company: e.target.value })}
                      placeholder={t("form.companyPlaceholder")}
                      className="rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
                    />
                  </div>
                  {status.kind === "err" && (
                    <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
                      <AlertTriangle className="mt-0.5 h-4 w-4" />
                      <span>{status.msg}</span>
                    </div>
                  )}
                  <button type="submit" disabled={status.kind === "submitting"} className="btn-accent">
                    {status.kind === "submitting" ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> {t("search.checkingLive")}</>
                    ) : (
                      <>{t("search.requestSelected")} <ArrowRight className="h-4 w-4" /></>
                    )}
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="container-page py-16 space-y-12">
        <PricingGroup
          icon={<Globe className="h-5 w-5 text-accent-700" />}
          title={t("groups.thnic.title")}
          subtitle={t("groups.thnic.subtitle")}
          rows={groups.thnic}
        />
        <PricingGroup
          icon={<ShieldCheck className="h-5 w-5 text-accent-700" />}
          title={t("groups.resellerclub.title")}
          subtitle={t("groups.resellerclub.subtitle")}
          rows={groups.rc}
        />
        <p className="text-xs text-navy-500">{t("table.currencyNote")}</p>
      </section>

      <section className="bg-navy-50">
        <div className="container-page py-14 text-center">
          <h2 className="font-display text-3xl text-navy-900">{t("cta.title")}</h2>
          <p className="mt-3 mx-auto max-w-2xl text-navy-600">{t("cta.body")}</p>
          <Link href="/contact" className="btn-accent mt-6 inline-flex">
            {t("cta.button")} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </>
  );
}

function ClassificationBadge({
  classification, label,
}: { classification: AvailabilityResult["classification"]; label: string }) {
  const cls =
    classification === "available" ? "bg-emerald-50 text-emerald-800" :
    classification === "registered" ? "bg-red-50 text-red-700" :
    classification === "premium" ? "bg-violet-50 text-violet-800" :
    classification === "manual" ? "bg-amber-50 text-amber-800" :
    "bg-navy-100 text-navy-700";
  return <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${cls}`}>{label}</span>;
}

function PricingGroup({
  icon, title, subtitle, rows,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  rows: DomainPricingItem[];
}) {
  const t = useTranslations("domains.table");
  if (rows.length === 0) return null;

  return (
    <div>
      <div className="flex items-start gap-3">
        <span className="rounded-full bg-accent-50 p-2">{icon}</span>
        <div>
          <h2 className="font-display text-2xl text-navy-900">{title}</h2>
          <p className="mt-1 text-sm text-navy-600">{subtitle}</p>
        </div>
      </div>

      <div className="mt-5 overflow-x-auto rounded-xl border border-navy-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-navy-50 text-left text-xs uppercase tracking-wider text-navy-500">
            <tr>
              <th className="px-4 py-3">{t("tld")}</th>
              <th className="px-4 py-3">{t("register")}</th>
              <th className="px-4 py-3">{t("renew")}</th>
              <th className="px-4 py-3">{t("transfer")}</th>
              <th className="px-4 py-3">{t("privacy")}</th>
              <th className="px-4 py-3">{t("notes")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-100">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3 font-medium text-navy-900">.{r.tld}</td>
                <td className="px-4 py-3 text-navy-700">฿{r.register_price_thb.toLocaleString()}</td>
                <td className="px-4 py-3 text-navy-700">฿{r.renew_price_thb.toLocaleString()}</td>
                <td className="px-4 py-3 text-navy-700">฿{r.transfer_price_thb.toLocaleString()}</td>
                <td className="px-4 py-3">
                  {r.privacy_included ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">
                      <ShieldCheck className="h-3 w-3" /> {t("privacyIncluded")}
                    </span>
                  ) : (
                    <span className="text-xs text-navy-500">{t("privacyExtra")}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-navy-600">
                  {r.is_thai_only && (
                    <span className="mr-1 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-amber-800">
                      {t("thaiOnly")}
                    </span>
                  )}
                  {r.notes}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function sanitizeSLD(s: string): string {
  let v = s.toLowerCase().trim().replace(/^\.+|\.+$/g, "");
  if (v.includes(".")) v = v.split(".")[0];
  return /^[a-z0-9-]+$/.test(v) && v.length > 0 ? v : "";
}
