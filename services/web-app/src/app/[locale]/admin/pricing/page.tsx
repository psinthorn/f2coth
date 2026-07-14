"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, Info } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import type { DomainPricingItem, HostingPlanItem } from "@/lib/api";

type Tab = "domains" | "hosting";

export default function AdminPricingPage() {
  const t = useTranslations("admin.pricing");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [tab, setTab] = useState<Tab>("domains");
  const [domains, setDomains] = useState<DomainPricingItem[]>([]);
  const [plans, setPlans] = useState<HostingPlanItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "/api";
    const headers = { "Accept-Language": locale };
    Promise.all([
      fetch(`${apiBase}/cms/domain-pricing`, { headers }).then((r) => r.json()),
      fetch(`${apiBase}/cms/hosting-plans`, { headers }).then((r) => r.json()),
    ])
      .then(([d, h]) => {
        setDomains(d.domain_pricing ?? []);
        setPlans(h.hosting_plans ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [locale]);

  return (
    <AdminShell>
      <header className="mb-6">
        <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-navy-600">{t("subtitle")}</p>
      </header>

      <div className="mb-4 flex items-center gap-1 rounded-full bg-navy-100 p-1 text-sm w-fit">
        {(["domains", "hosting"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded-full px-4 py-1.5 transition ${
              tab === k ? "bg-white text-navy-900 shadow" : "text-navy-600"
            }`}
          >
            {t(`tabs.${k}`)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-navy-500">
          <Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}
        </div>
      ) : tab === "domains" ? (
        <DomainsTable rows={domains} />
      ) : (
        <HostingTable rows={plans} />
      )}

      <div className="mt-6 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
        <Info className="mt-0.5 h-4 w-4" />
        <span>{t("editNote")}</span>
      </div>
    </AdminShell>
  );
}

function DomainsTable({ rows }: { rows: DomainPricingItem[] }) {
  const t = useTranslations("admin.pricing.domains");
  return (
    <div className="overflow-x-auto rounded-xl border border-navy-200 bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-navy-50 text-left text-xs uppercase tracking-wider text-navy-500">
          <tr>
            <th className="px-4 py-3">{t("tld")}</th>
            <th className="px-4 py-3">{t("registry")}</th>
            <th className="px-4 py-3">{t("register")}</th>
            <th className="px-4 py-3">{t("renew")}</th>
            <th className="px-4 py-3">{t("transfer")}</th>
            <th className="px-4 py-3">{t("privacy")}</th>
            <th className="px-4 py-3">{t("graceFee")}</th>
            <th className="px-4 py-3">{t("redemptionFee")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-navy-100">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="px-4 py-3 font-medium text-navy-900">.{r.tld}</td>
              <td className="px-4 py-3 text-navy-700">
                <span className="rounded-full bg-navy-100 px-2 py-0.5 text-xs">{t(`registries.${r.registry}`)}</span>
                {r.is_thai_only && (
                  <span className="ml-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">{t("thaiOnly")}</span>
                )}
              </td>
              <td className="px-4 py-3 text-navy-700">฿{r.register_price_thb.toLocaleString()}</td>
              <td className="px-4 py-3 text-navy-700">฿{r.renew_price_thb.toLocaleString()}</td>
              <td className="px-4 py-3 text-navy-700">฿{r.transfer_price_thb.toLocaleString()}</td>
              <td className="px-4 py-3 text-navy-700">{r.privacy_included ? "✓" : "—"}</td>
              <td className="px-4 py-3 text-navy-700">
                {r.grace_fee_thb > 0 ? `฿${r.grace_fee_thb.toLocaleString()}` : "—"}
                <span className="ml-1 text-xs text-navy-400">/ {r.grace_period_days}d</span>
              </td>
              <td className="px-4 py-3 text-navy-700">
                {r.redemption_fee_thb > 0 ? `฿${r.redemption_fee_thb.toLocaleString()}` : "—"}
                <span className="ml-1 text-xs text-navy-400">/ {r.redemption_period_days}d</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HostingTable({ rows }: { rows: HostingPlanItem[] }) {
  const t = useTranslations("admin.pricing.hosting");
  return (
    <div className="overflow-x-auto rounded-xl border border-navy-200 bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-navy-50 text-left text-xs uppercase tracking-wider text-navy-500">
          <tr>
            <th className="px-4 py-3">{t("plan")}</th>
            <th className="px-4 py-3">{t("monthly")}</th>
            <th className="px-4 py-3">{t("annual")}</th>
            <th className="px-4 py-3">{t("storage")}</th>
            <th className="px-4 py-3">{t("sites")}</th>
            <th className="px-4 py-3">{t("emails")}</th>
            <th className="px-4 py-3">{t("bandwidth")}</th>
            <th className="px-4 py-3">{t("ssl")}</th>
            <th className="px-4 py-3">{t("backups")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-navy-100">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="px-4 py-3">
                <span className="font-medium text-navy-900">{r.name}</span>
                {r.is_featured && (
                  <span className="ml-2 rounded-full bg-accent-50 px-2 py-0.5 text-xs text-accent-800">{t("featured")}</span>
                )}
                <p className="mt-0.5 text-xs text-navy-500">{r.tagline}</p>
              </td>
              <td className="px-4 py-3 text-navy-700">฿{r.price_thb_monthly.toLocaleString()}</td>
              <td className="px-4 py-3 text-navy-700">฿{r.price_thb_annually.toLocaleString()}</td>
              <td className="px-4 py-3 text-navy-700">{r.storage_gb} GB</td>
              <td className="px-4 py-3 text-navy-700">{r.sites_included === 0 ? t("unlimited") : r.sites_included}</td>
              <td className="px-4 py-3 text-navy-700">{r.emails_included === 0 ? t("unlimited") : r.emails_included}</td>
              <td className="px-4 py-3 text-navy-700">{r.bandwidth_label}</td>
              <td className="px-4 py-3 text-navy-700">{r.ssl_included ? "✓" : "—"}</td>
              <td className="px-4 py-3 text-navy-700">{r.daily_backups ? "✓" : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
