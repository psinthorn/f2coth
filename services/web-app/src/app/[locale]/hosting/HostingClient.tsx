"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Check, ShieldCheck, HardDrive, Globe, Mail, Cloud, ArrowRight } from "lucide-react";
import type { HostingPlanItem } from "@/lib/api";

type Cycle = "monthly" | "annual";

export default function HostingClient({ plans }: { plans: HostingPlanItem[] }) {
  const t = useTranslations("hosting");
  const [cycle, setCycle] = useState<Cycle>("monthly");

  const fromPrice = useMemo(() => {
    if (plans.length === 0) return 0;
    return Math.min(...plans.map((p) => p.price_thb_monthly));
  }, [plans]);

  return (
    <>
      <section className="bg-navy-50">
        <div className="container-page py-16">
          <p className="text-sm font-semibold uppercase tracking-wider text-accent-700">{t("hero.kicker")}</p>
          <h1 className="mt-2 font-display text-4xl text-navy-900 sm:text-5xl">{t("hero.title")}</h1>
          <p className="mt-4 max-w-2xl text-navy-600">{t("hero.subtitle")}</p>
          {fromPrice > 0 && (
            <p className="mt-4 text-sm text-navy-700">
              <span className="text-navy-500">{t("hero.fromLabel")}</span>{" "}
              <span className="font-display text-2xl text-navy-900">฿{fromPrice.toLocaleString()}</span>
              <span className="text-navy-500">{t("hero.perMonth")}</span>
            </p>
          )}

          <div className="mt-6 inline-flex rounded-full border border-navy-200 bg-white p-1 text-sm">
            <button
              onClick={() => setCycle("monthly")}
              className={`rounded-full px-4 py-1.5 transition ${
                cycle === "monthly" ? "bg-accent-600 text-white" : "text-navy-700"
              }`}
            >
              {t("billing.monthly")}
            </button>
            <button
              onClick={() => setCycle("annual")}
              className={`rounded-full px-4 py-1.5 transition ${
                cycle === "annual" ? "bg-accent-600 text-white" : "text-navy-700"
              }`}
            >
              {t("billing.annual")} <span className="ml-1 text-[10px] uppercase tracking-wider text-emerald-600">{t("billing.save")}</span>
            </button>
          </div>
        </div>
      </section>

      <section className="container-page py-16">
        <div className="grid gap-6 md:grid-cols-3">
          {plans.map((p) => (
            <PlanCard key={p.id} plan={p} cycle={cycle} />
          ))}
        </div>
      </section>

      <section className="bg-navy-50">
        <div className="container-page py-16">
          <h2 className="font-display text-3xl text-navy-900">{t("compare.title")}</h2>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {(t.raw("compare.items") as { label: string; body: string }[]).map((it, i) => (
              <div key={i} className="card">
                <h3 className="font-semibold text-navy-900">{it.label}</h3>
                <p className="mt-2 text-sm text-navy-600">{it.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="container-page py-14 text-center">
        <Cloud className="mx-auto h-8 w-8 text-accent-700" />
        <h2 className="mt-3 font-display text-3xl text-navy-900">{t("cta.title")}</h2>
        <p className="mt-3 mx-auto max-w-2xl text-navy-600">{t("cta.body")}</p>
        <Link
          href={"/services/cloud-infrastructure" as never}
          className="btn-accent mt-6 inline-flex"
        >
          {t("cta.button")} <ArrowRight className="h-4 w-4" />
        </Link>
      </section>
    </>
  );
}

function PlanCard({ plan, cycle }: { plan: HostingPlanItem; cycle: Cycle }) {
  const t = useTranslations("hosting");
  const tc = useTranslations("hosting.card");
  const price = cycle === "monthly" ? plan.price_thb_monthly : plan.price_thb_annually;
  const cycleLabel = cycle === "monthly" ? t("billing.perMonth") : t("billing.perYear");
  const sites = plan.sites_included === 0 ? tc("unlimited") : plan.sites_included.toString();
  const emails = plan.emails_included === 0 ? tc("unlimited") : plan.emails_included.toString();

  return (
    <div className={`card flex flex-col ${plan.is_featured ? "ring-2 ring-accent-500" : ""}`}>
      {plan.is_featured && (
        <span className="self-start rounded-full bg-accent-600 px-3 py-1 text-xs font-semibold text-white">
          {tc("popular")}
        </span>
      )}
      <h3 className="mt-3 font-display text-2xl text-navy-900">{plan.name}</h3>
      <p className="mt-1 text-sm text-navy-600">{plan.tagline}</p>

      <div className="mt-5">
        <span className="font-display text-4xl text-navy-900">฿{price.toLocaleString()}</span>
        <span className="text-sm text-navy-500">{cycleLabel}</span>
      </div>

      <ul className="mt-5 space-y-2 text-sm text-navy-700">
        <Spec icon={<HardDrive className="h-4 w-4 text-navy-400" />} label={tc("storage")} value={`${plan.storage_gb} ${tc("storageUnit")}`} />
        <Spec icon={<Globe className="h-4 w-4 text-navy-400" />} label={tc("sites")} value={sites} />
        <Spec icon={<Mail className="h-4 w-4 text-navy-400" />} label={tc("emails")} value={emails} />
        <Spec icon={<Cloud className="h-4 w-4 text-navy-400" />} label={tc("bandwidth")} value={plan.bandwidth_label} />
        <Spec icon={<ShieldCheck className="h-4 w-4 text-navy-400" />} label={tc("ssl")} value={plan.ssl_included ? "✓" : "—"} />
        <Spec icon={<Check className="h-4 w-4 text-navy-400" />} label={tc("backups")} value={plan.daily_backups ? "✓" : "—"} />
      </ul>

      {plan.perks.length > 0 && (
        <div className="mt-5 border-t border-navy-100 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-navy-500">{tc("perksTitle")}</p>
          <ul className="mt-2 space-y-1.5 text-sm text-navy-700">
            {plan.perks.map((perk, i) => (
              <li key={i} className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent-600" />
                <span>{perk}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Link
        href={`/contact?service=${plan.slug === "starter" ? "web-design" : "cloud-infrastructure"}` as never}
        className="btn-accent mt-6 w-full justify-center"
      >
        {tc("ctaPrimary")} <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

function Spec({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-2 text-navy-600">{icon} {label}</span>
      <span className="font-medium text-navy-900">{value}</span>
    </li>
  );
}
