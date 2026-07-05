"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, TrendingUp, BarChart3, Users } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import {
  adminApi,
  type MRRPoint,
  type ARAgingResp,
  type ChurnPoint,
} from "@/lib/admin-api";
import { formatMoney } from "@/lib/payment-types";

// Minimalist analytics dashboard — pure tables + tiny inline SVG bar
// charts. No charting library so the bundle stays light and the visual
// matches the rest of the admin console.
export default function AdminAnalyticsPage() {
  const t = useTranslations("admin.analytics");
  const tc = useTranslations("common");
  const [mrr, setMRR] = useState<MRRPoint[] | null>(null);
  const [aging, setAging] = useState<ARAgingResp | null>(null);
  const [churn, setChurn] = useState<ChurnPoint[] | null>(null);

  useEffect(() => {
    adminApi.analyticsMRR().then(setMRR).catch(() => setMRR([]));
    adminApi.analyticsAging().then(setAging).catch(() => setAging(null));
    adminApi.analyticsChurn().then(setChurn).catch(() => setChurn([]));
  }, []);

  const mrrMax = (mrr ?? []).reduce((m, p) => Math.max(m, p.all_revenue_cents), 0);
  const churnMax = (churn ?? []).reduce((m, p) => Math.max(m, p.churn_rate_percent), 0);

  return (
    <AdminShell>
      <header className="mb-6">
        <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-navy-600">{t("subtitle")}</p>
      </header>

      {/* MRR section */}
      <section className="card mb-6">
        <h2 className="mb-3 font-display text-lg text-navy-900 inline-flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-accent-700" /> {t("mrrTitle")}
        </h2>
        <p className="mb-4 text-xs text-navy-500">{t("mrrSubtitle")}</p>
        {mrr === null ? (
          <div className="text-navy-500"><Loader2 className="inline h-4 w-4 animate-spin" /> {tc("loading")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-navy-500 border-b border-navy-100">
                  <th className="py-2 pr-2 font-semibold">{t("col.month")}</th>
                  <th className="py-2 px-2 font-semibold text-right">{t("col.allRevenue")}</th>
                  <th className="py-2 px-2 font-semibold text-right">{t("col.subRevenue")}</th>
                  <th className="py-2 px-2 font-semibold text-right">{t("col.payments")}</th>
                  <th className="py-2 pl-2 font-semibold w-1/3">{t("col.trend")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-50">
                {mrr.map((p) => {
                  const allW = mrrMax > 0 ? (p.all_revenue_cents / mrrMax) * 100 : 0;
                  const subW = mrrMax > 0 ? (p.sub_revenue_cents / mrrMax) * 100 : 0;
                  return (
                    <tr key={p.month}>
                      <td className="py-2 pr-2 font-mono text-xs">{p.month}</td>
                      <td className="py-2 px-2 text-right">{formatMoney(p.all_revenue_cents)}</td>
                      <td className="py-2 px-2 text-right text-navy-700">
                        {formatMoney(p.sub_revenue_cents)}
                        {p.all_revenue_cents > 0 && (
                          <span className="text-[10px] text-navy-400 ml-1">
                            ({Math.round((p.sub_revenue_cents / p.all_revenue_cents) * 100)}%)
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right text-xs text-navy-600">{p.payments_count}</td>
                      <td className="py-2 pl-2">
                        <div className="relative h-4 w-full rounded bg-navy-50 overflow-hidden">
                          <div className="absolute inset-y-0 left-0 bg-accent-500" style={{ width: `${allW}%` }} />
                          <div className="absolute inset-y-0 left-0 bg-emerald-500 opacity-70" style={{ width: `${subW}%` }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-3 text-[10px] text-navy-500 flex items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-3 rounded bg-accent-500" /> {t("legendAll")}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-3 rounded bg-emerald-500" /> {t("legendSub")}
              </span>
            </p>
          </div>
        )}
      </section>

      {/* AR aging */}
      <section className="card mb-6">
        <h2 className="mb-3 font-display text-lg text-navy-900 inline-flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-accent-700" /> {t("agingTitle")}
        </h2>
        <p className="mb-4 text-xs text-navy-500">{t("agingSubtitle")}</p>
        {aging === null ? (
          <div className="text-navy-500"><Loader2 className="inline h-4 w-4 animate-spin" /> {tc("loading")}</div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-5">
            {aging.buckets.map((b) => {
              const tone =
                b.label === "current" ? "border-emerald-300 bg-emerald-50/40"
                : b.label === "1_30" ? "border-amber-200 bg-amber-50/40"
                : b.label === "31_60" ? "border-amber-400 bg-amber-100/60"
                : b.label === "61_90" ? "border-red-300 bg-red-50/60"
                : "border-red-500 bg-red-100/70";
              return (
                <div key={b.label} className={`rounded-lg border-2 p-3 ${tone}`}>
                  <p className="text-xs uppercase tracking-wider text-navy-600">{t(`bucket.${b.label}`)}</p>
                  <p className="mt-2 font-display text-xl text-navy-900">{formatMoney(b.cents)}</p>
                  <p className="text-[10px] text-navy-500">
                    {t("invoiceCount", { count: b.count })}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Churn */}
      <section className="card">
        <h2 className="mb-3 font-display text-lg text-navy-900 inline-flex items-center gap-2">
          <Users className="h-5 w-5 text-accent-700" /> {t("churnTitle")}
        </h2>
        <p className="mb-4 text-xs text-navy-500">{t("churnSubtitle")}</p>
        {churn === null ? (
          <div className="text-navy-500"><Loader2 className="inline h-4 w-4 animate-spin" /> {tc("loading")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-navy-500 border-b border-navy-100">
                  <th className="py-2 pr-2 font-semibold">{t("col.month")}</th>
                  <th className="py-2 px-2 font-semibold text-right">{t("col.cancelled")}</th>
                  <th className="py-2 px-2 font-semibold text-right">{t("col.activeStart")}</th>
                  <th className="py-2 px-2 font-semibold text-right">{t("col.churnRate")}</th>
                  <th className="py-2 pl-2 font-semibold w-1/3">{t("col.trend")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-50">
                {churn.map((p) => {
                  const w = churnMax > 0 ? (p.churn_rate_percent / churnMax) * 100 : 0;
                  return (
                    <tr key={p.month}>
                      <td className="py-2 pr-2 font-mono text-xs">{p.month}</td>
                      <td className="py-2 px-2 text-right text-navy-700">{p.cancelled_count}</td>
                      <td className="py-2 px-2 text-right text-navy-700">{p.active_at_start}</td>
                      <td className="py-2 px-2 text-right">
                        <span className={`${p.churn_rate_percent > 10 ? "text-red-700" : "text-navy-900"}`}>
                          {p.churn_rate_percent.toFixed(2)}%
                        </span>
                      </td>
                      <td className="py-2 pl-2">
                        <div className="relative h-4 w-full rounded bg-navy-50 overflow-hidden">
                          <div
                            className={`absolute inset-y-0 left-0 ${p.churn_rate_percent > 10 ? "bg-red-500" : "bg-blue-500"}`}
                            style={{ width: `${w}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AdminShell>
  );
}
