"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Loader2, Globe, ShieldCheck, Calendar, Clock, AlertCircle, Lock, Plus,
} from "lucide-react";
import { Link } from "@/i18n/routing";
import PortalShell from "@/components/PortalShell";
import { portalApi, type PortalDomain, type PortalDomainOrder } from "@/lib/portal-api";

export default function PortalDomainsPage() {
  const t = useTranslations("portal.domains");
  const to = useTranslations("portal.domains.orders");
  const tc = useTranslations("common");
  const [domains, setDomains] = useState<PortalDomain[] | null>(null);
  const [orders, setOrders] = useState<PortalDomainOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    Promise.all([
      portalApi.listDomains().catch((e: any) => {
        if (e?.status === 404) setForbidden(true);
        return { domains: [] as PortalDomain[] };
      }),
      portalApi.listDomainOrders().catch(() => ({ orders: [] as PortalDomainOrder[] })),
    ])
      .then(([d, o]) => {
        setDomains(d.domains ?? []);
        setOrders(o.orders ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  // Pending orders are everything that hasn't been fulfilled yet.
  const pendingOrders = orders.filter(
    (o) => o.status !== "registered" && o.status !== "active" && o.status !== "cancelled" && o.status !== "rejected" && o.status !== "failed",
  );
  const historyOrders = orders.filter(
    (o) => o.status === "registered" || o.status === "active" || o.status === "cancelled" || o.status === "rejected" || o.status === "failed",
  );

  return (
    <PortalShell>
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
          <p className="mt-1 text-sm text-navy-600">{t("subtitle")}</p>
        </div>
        <Link href={"/portal/domains/new" as never} className="btn-accent shrink-0">
          <Plus className="h-4 w-4" /> {to("requestNew")}
        </Link>
      </header>

      {pendingOrders.length > 0 && !loading && (
        <section className="mb-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-navy-500">{to("pendingTitle")}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {pendingOrders.map((o) => (
              <div key={o.id} className="card">
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-2 font-medium text-navy-900">
                    <Globe className="h-3.5 w-3.5 text-navy-400" /> {o.fqdn}
                  </p>
                  <OrderStatusPill status={o.status} label={to(`status.${o.status}`)} />
                </div>
                <p className="mt-1 text-xs text-navy-500">
                  {to("requestedOn", { date: new Date(o.created_at).toLocaleDateString() })}
                  {" · "}{o.years} {to("years")}{o.privacy_enabled ? ` · ${to("privacyOn")}` : ""}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-navy-500"><Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}</div>
      ) : forbidden ? (
        <div className="card text-center text-navy-500">
          <Lock className="mx-auto h-6 w-6 mb-2 text-navy-300" />
          {t("notEntitled")}
          <br />{t("talkToManager")}
        </div>
      ) : !domains || domains.length === 0 ? (
        <div className="card text-center text-navy-500">{t("noneYet")}</div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-navy-50 text-left text-xs uppercase tracking-wider text-navy-500">
              <tr>
                <th className="px-4 py-3 font-semibold">{t("table.domain")}</th>
                <th className="px-4 py-3 font-semibold">{t("table.registrar")}</th>
                <th className="px-4 py-3 font-semibold">{t("table.expires")}</th>
                <th className="px-4 py-3 font-semibold">{t("table.privacy")}</th>
                <th className="px-4 py-3 font-semibold">{t("table.autoRenew")}</th>
                <th className="px-4 py-3 font-semibold">{t("table.lastDnsChange")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {domains.map((d) => {
                const days = daysUntil(d.expires_at);
                return (
                  <tr key={d.id} className="hover:bg-navy-50">
                    <td className="px-4 py-3">
                      <p className="flex items-center gap-2 font-medium text-navy-900">
                        <Globe className="h-3.5 w-3.5 text-navy-400" />
                        {d.domain}
                      </p>
                      {d.notes && <p className="mt-1 text-xs text-navy-500">{d.notes}</p>}
                    </td>
                    <td className="px-4 py-3 text-navy-700">{d.registrar}</td>
                    <td className="px-4 py-3">
                      <p className="flex items-center gap-1 text-navy-700">
                        <Calendar className="h-3.5 w-3.5 text-navy-400" />
                        {fmtDate(d.expires_at)}
                      </p>
                      {days !== null && (
                        <p className={`mt-0.5 text-xs ${days < 60 ? "text-red-700" : "text-navy-500"}`}>
                          {days < 0 ? t("daysOverdue", { days: -days }) : t("daysLeft", { days })}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {d.privacy_enabled ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">
                          <ShieldCheck className="h-3 w-3" /> {t("privacyEnabled")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
                          <AlertCircle className="h-3 w-3" /> {t("privacyOff")}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-navy-700">{d.auto_renew ? t("yes") : t("no")}</td>
                    <td className="px-4 py-3 text-navy-500 text-xs">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {fmtDate(d.last_dns_change_at) || "—"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !forbidden && (
        <p className="mt-4 text-xs text-navy-500">
          {t("footnote")}
          {" "}<Link href="/portal/tickets/new" className="text-accent-700 hover:text-accent-900">{t("openTicket")}</Link>.
        </p>
      )}

      {!loading && !forbidden && historyOrders.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-navy-500">{to("historyTitle")}</h2>
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-navy-50 text-left text-xs uppercase tracking-wider text-navy-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">{to("col.domain")}</th>
                  <th className="px-4 py-3 font-semibold">{to("col.registry")}</th>
                  <th className="px-4 py-3 font-semibold">{to("col.years")}</th>
                  <th className="px-4 py-3 font-semibold">{to("col.privacy")}</th>
                  <th className="px-4 py-3 font-semibold">{to("col.status")}</th>
                  <th className="px-4 py-3 font-semibold">{to("col.date")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {historyOrders.map((o) => (
                  <tr key={o.id} className="hover:bg-navy-50">
                    <td className="px-4 py-3">
                      <p className="flex items-center gap-2 font-medium text-navy-900">
                        <Globe className="h-3.5 w-3.5 text-navy-400" />
                        {o.fqdn}
                      </p>
                      {o.notes && <p className="mt-0.5 text-xs text-navy-500">{o.notes}</p>}
                    </td>
                    <td className="px-4 py-3 text-navy-600 text-xs uppercase">{o.registry}</td>
                    <td className="px-4 py-3 text-navy-700">{o.years} {to("years")}</td>
                    <td className="px-4 py-3">
                      {o.privacy_enabled ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">
                          <ShieldCheck className="h-3 w-3" /> {to("privacyOn")}
                        </span>
                      ) : (
                        <span className="text-xs text-navy-400">{t("privacyOff")}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <OrderStatusPill status={o.status} label={to(`status.${o.status}`)} />
                    </td>
                    <td className="px-4 py-3 text-navy-500 text-xs">
                      {fmtDate(o.updated_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </PortalShell>
  );
}

function OrderStatusPill({ status, label }: { status: PortalDomainOrder["status"]; label: string }) {
  const cls =
    status === "active" || status === "registered" ? "bg-emerald-50 text-emerald-800" :
    status === "approved" ? "bg-blue-50 text-blue-800" :
    status === "quoted" ? "bg-violet-50 text-violet-800" :
    status === "rejected" || status === "failed" || status === "cancelled" ? "bg-red-50 text-red-800" :
    "bg-amber-50 text-amber-800";
  return <span className={`rounded-full px-2 py-0.5 text-xs ${cls}`}>{label}</span>;
}

function fmtDate(s: string | null) {
  if (!s) return "";
  return new Date(s).toLocaleDateString();
}

function daysUntil(s: string | null): number | null {
  if (!s) return null;
  const ms = new Date(s).getTime() - Date.now();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}
