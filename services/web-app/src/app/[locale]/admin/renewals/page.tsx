"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, RotateCcw, Globe, Repeat, Bell } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { adminApi, type RenewalsDashboard } from "@/lib/admin-api";
import { formatMoney } from "@/lib/payment-types";

const WINDOWS = [30, 60, 90] as const;

function daysBadge(d: number) {
  // Expired = red, ≤7 = amber, else neutral.
  if (d < 0) return "bg-red-50 text-red-700";
  if (d <= 7) return "bg-amber-50 text-amber-800";
  return "bg-navy-100 text-navy-600";
}

export default function AdminRenewalsPage() {
  const t = useTranslations("admin.renewals");
  const [data, setData] = useState<RenewalsDashboard | null>(null);
  const [days, setDays] = useState<number>(60);

  function load() {
    setData(null);
    adminApi.renewalsDashboard(days).then(setData).catch(() => setData(null));
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  return (
    <AdminShell>
      <header className="mb-6 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
          <p className="mt-1 text-sm text-navy-600">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 text-xs">
            {WINDOWS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setDays(w)}
                className={`rounded-full border px-3 py-1 ${
                  days === w
                    ? "border-accent-500 bg-accent-50 text-accent-900"
                    : "border-navy-200 text-navy-600 hover:bg-navy-50"
                }`}
              >
                {t("window", { days: w })}
              </button>
            ))}
          </div>
          <button type="button" className="btn-ghost" onClick={load} aria-label={t("refresh")}>
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </header>

      {!data ? (
        <div className="flex items-center gap-2 text-navy-500">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("loading")}
        </div>
      ) : (
        <div className="space-y-8">
          {/* Upcoming subscriptions */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-navy-500">
              <Repeat className="h-4 w-4" /> {t("subs.title")} ({data.upcoming_subscriptions.length})
            </h2>
            <div className="overflow-x-auto rounded-xl border border-navy-200 bg-white">
              <table className="min-w-full text-sm">
                <thead className="bg-navy-50 text-left text-xs uppercase tracking-wider text-navy-500">
                  <tr>
                    <th className="px-4 py-3">{t("cols.customer")}</th>
                    <th className="px-4 py-3">{t("cols.service")}</th>
                    <th className="px-4 py-3">{t("cols.cycle")}</th>
                    <th className="px-4 py-3">{t("cols.amount")}</th>
                    <th className="px-4 py-3">{t("cols.renews")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-100">
                  {data.upcoming_subscriptions.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-6 text-center text-navy-400">{t("empty")}</td></tr>
                  ) : (
                    data.upcoming_subscriptions.map((s) => (
                      <tr key={s.id}>
                        <td className="px-4 py-3 text-navy-700">{s.customer_name}</td>
                        <td className="px-4 py-3 font-medium text-navy-900">{s.title}</td>
                        <td className="px-4 py-3 text-navy-600">{t(`cycles.${s.billing_cycle}`)}</td>
                        <td className="px-4 py-3 tabular-nums text-navy-700">{formatMoney(s.amount_cents, s.currency)}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs ${daysBadge(s.days_until)}`}>
                            {s.next_billing_at} · {t("inDays", { days: s.days_until })}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Upcoming domains */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-navy-500">
              <Globe className="h-4 w-4" /> {t("domains.title")} ({data.upcoming_domains.length})
            </h2>
            <div className="overflow-x-auto rounded-xl border border-navy-200 bg-white">
              <table className="min-w-full text-sm">
                <thead className="bg-navy-50 text-left text-xs uppercase tracking-wider text-navy-500">
                  <tr>
                    <th className="px-4 py-3">{t("cols.customer")}</th>
                    <th className="px-4 py-3">{t("cols.domain")}</th>
                    <th className="px-4 py-3">{t("cols.registrar")}</th>
                    <th className="px-4 py-3">{t("cols.autoRenew")}</th>
                    <th className="px-4 py-3">{t("cols.expires")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-100">
                  {data.upcoming_domains.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-6 text-center text-navy-400">{t("empty")}</td></tr>
                  ) : (
                    data.upcoming_domains.map((d) => (
                      <tr key={d.id}>
                        <td className="px-4 py-3 text-navy-700">{d.customer_name}</td>
                        <td className="px-4 py-3 font-medium text-navy-900">{d.domain}</td>
                        <td className="px-4 py-3 text-navy-600">{d.registrar}</td>
                        <td className="px-4 py-3">{d.auto_renew ? "✓" : "—"}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs ${daysBadge(d.days_until)}`}>
                            {d.expires_at} · {d.days_until < 0 ? t("expired", { days: -d.days_until }) : t("inDays", { days: d.days_until })}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Recent reminder/notice log */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-navy-500">
              <Bell className="h-4 w-4" /> {t("log.title")}
            </h2>
            <div className="overflow-x-auto rounded-xl border border-navy-200 bg-white">
              <table className="min-w-full text-sm">
                <thead className="bg-navy-50 text-left text-xs uppercase tracking-wider text-navy-500">
                  <tr>
                    <th className="px-4 py-3">{t("cols.sent")}</th>
                    <th className="px-4 py-3">{t("cols.type")}</th>
                    <th className="px-4 py-3">{t("cols.item")}</th>
                    <th className="px-4 py-3">{t("cols.notice")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-100">
                  {data.recent_reminders.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-6 text-center text-navy-400">{t("log.empty")}</td></tr>
                  ) : (
                    data.recent_reminders.map((l, i) => (
                      <tr key={i}>
                        <td className="px-4 py-3 tabular-nums text-navy-500">{new Date(l.sent_at).toLocaleString()}</td>
                        <td className="px-4 py-3 text-navy-600">{t(`types.${l.entity_type}`)}</td>
                        <td className="px-4 py-3 text-navy-800">{l.label}{l.customer_name ? ` · ${l.customer_name}` : ""}</td>
                        <td className="px-4 py-3 font-mono text-xs text-navy-500">{l.template_used}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </AdminShell>
  );
}
