"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Receipt, AlertCircle, TrendingUp, Inbox } from "lucide-react";
import { Link } from "@/i18n/routing";
import { adminApi, type PaymentDashboardSummary } from "@/lib/admin-api";
import { formatMoney } from "@/lib/payment-types";

// Dashboard widget for the admin home page. Fetches once on mount;
// shows nothing if the user lacks permission (silent fail — the rest of
// the dashboard renders fine without it).
export default function BillingDashboardWidget() {
  const t = useTranslations("admin.dashboardWidget");
  const [data, setData] = useState<PaymentDashboardSummary | null>(null);

  useEffect(() => {
    adminApi.paymentDashboard().then(setData).catch(() => setData(null));
  }, []);

  if (!data) return null;

  return (
    <section className="card">
      <header className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-lg text-navy-900">{t("title")}</h3>
        <Link href="/admin/invoices" className="text-xs text-accent-700 hover:underline">
          {t("viewAll")}
        </Link>
      </header>
      <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <Stat
          icon={TrendingUp}
          tone="emerald"
          label={t("thisMonth")}
          value={formatMoney(data.month_revenue_cents)}
          sub={t("paymentsCount", { count: data.month_payments_count })}
        />
        <Stat
          icon={Receipt}
          tone="blue"
          label={t("outstanding")}
          value={formatMoney(data.outstanding_cents)}
          sub={t("invoicesCount", { count: data.outstanding_count })}
        />
        <Stat
          icon={AlertCircle}
          tone="red"
          label={t("overdue")}
          value={formatMoney(data.overdue_cents)}
          sub={t("invoicesCount", { count: data.overdue_count })}
        />
        <Stat
          icon={Inbox}
          tone="amber"
          label={t("verificationQueue")}
          value={String(data.verification_queue_count)}
          sub={t("paymentsAwaiting")}
          link="/admin/payments?status=awaiting_verification"
        />
      </div>
    </section>
  );
}

function Stat({
  icon: Icon, tone, label, value, sub, link,
}: {
  icon: typeof Receipt;
  tone: "emerald" | "blue" | "red" | "amber";
  label: string;
  value: string;
  sub: string;
  link?: string;
}) {
  const toneClass = {
    emerald: "text-emerald-700 bg-emerald-50",
    blue:    "text-blue-700 bg-blue-50",
    red:     "text-red-700 bg-red-50",
    amber:   "text-amber-800 bg-amber-50",
  }[tone];

  const content = (
    <div className="rounded-lg border border-navy-100 p-3 hover:border-navy-200 transition">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-navy-500">{label}</span>
        <span className={`grid h-6 w-6 place-items-center rounded ${toneClass}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
      </div>
      <p className="mt-2 font-display text-xl text-navy-900">{value}</p>
      <p className="text-[10px] text-navy-500">{sub}</p>
    </div>
  );
  if (link) {
    return <Link href={link as never}>{content}</Link>;
  }
  return content;
}
