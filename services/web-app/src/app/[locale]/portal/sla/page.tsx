"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Calendar, Lock, Activity } from "lucide-react";
import { Link } from "@/i18n/routing";
import PortalShell from "@/components/PortalShell";
import { portalApi, type PortalSLA } from "@/lib/portal-api";

export default function PortalSLAPage() {
  const t = useTranslations("portal.sla");
  const tc = useTranslations("common");
  const [contracts, setContracts] = useState<PortalSLA[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    portalApi.listSLA()
      .then((d) => setContracts(d.sla_contracts ?? []))
      .catch((e: any) => {
        if (e?.status === 404) setForbidden(true);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <PortalShell>
      <header className="mb-6">
        <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-navy-600">{t("subtitle")}</p>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-navy-500"><Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}</div>
      ) : forbidden || contracts.length === 0 ? (
        <div className="card text-center text-navy-500">
          <Lock className="mx-auto h-6 w-6 mb-2 text-navy-300" />
          {t("noneYet")}
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {contracts.map((c) => {
            const remaining = daysBetween(new Date(), c.ends_on);
            const total = daysBetween(c.starts_on, c.ends_on);
            const elapsedPct = total > 0 ? Math.max(0, Math.min(100, ((total - remaining) / total) * 100)) : 0;
            const isExpired = c.status === "expired" || remaining < 0;

            return (
              <div key={c.id} className="card flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs uppercase tracking-wider text-accent-700">{c.service_slug}</p>
                    <h2 className="mt-1 font-display text-xl text-navy-900">{c.title}</h2>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${statusColor(c.status)}`}>
                    {c.status}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-navy-500">{t("period")}</p>
                    <p className="mt-0.5 flex items-center gap-1 text-navy-900">
                      <Calendar className="h-3.5 w-3.5 text-navy-400" />
                      {fmtShort(c.starts_on)} – {fmtShort(c.ends_on)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-navy-500">{t("targetUptime")}</p>
                    <p className="mt-0.5 flex items-center gap-1 text-navy-900">
                      <Activity className="h-3.5 w-3.5 text-accent-700" />
                      {c.target_uptime_pct.toFixed(2)}%
                    </p>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs text-navy-500">
                    <span>{t("periodProgress")}</span>
                    <span>
                      {isExpired
                        ? t("daysOverdue", { days: -remaining })
                        : t("daysRemaining", { days: remaining })}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 w-full rounded-full bg-navy-100 overflow-hidden">
                    <div
                      className={`h-full ${isExpired ? "bg-red-500" : "bg-accent-600"}`}
                      style={{ width: `${elapsedPct}%` }}
                    />
                  </div>
                </div>

                {c.notes && (
                  <p className="rounded-lg bg-navy-50 p-3 text-xs text-navy-700">{c.notes}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!loading && !forbidden && (
        <p className="mt-4 text-xs text-navy-500">
          {t("footnote")}
          {" "}<Link href="/portal/tickets/new" className="text-accent-700 hover:text-accent-900">{t("openTicket")}</Link>.
        </p>
      )}
    </PortalShell>
  );
}

function statusColor(s: string): string {
  switch (s) {
    case "active": return "bg-emerald-50 text-emerald-800";
    case "renewing": return "bg-amber-50 text-amber-800";
    case "expired": return "bg-red-50 text-red-800";
    default: return "bg-navy-100 text-navy-700";
  }
}

function fmtShort(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function daysBetween(start: string | Date, end: string | Date): number {
  const s = typeof start === "string" ? new Date(start) : start;
  const e = typeof end === "string" ? new Date(end) : end;
  return Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
}
