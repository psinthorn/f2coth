"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import {
  Loader2, Mail, ArrowRight, CheckCircle2, Inbox, Plus,
} from "lucide-react";
import PortalShell from "@/components/PortalShell";
import { portalApi, type PortalContact, type PortalCustomer, type PortalTicket } from "@/lib/portal-api";

const statusColor: Record<string, string> = {
  open: "bg-accent-50 text-accent-800",
  in_progress: "bg-blue-50 text-blue-800",
  waiting_customer: "bg-amber-50 text-amber-800",
  resolved: "bg-emerald-50 text-emerald-800",
  closed: "bg-navy-100 text-navy-700",
};

export default function PortalHome() {
  const t = useTranslations("portal.home");
  const tc = useTranslations("common");
  const [me, setMe] = useState<{ contact: PortalContact; customer: PortalCustomer } | null>(null);
  const [tickets, setTickets] = useState<PortalTicket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([portalApi.me(), portalApi.listTickets()])
      .then(([m, ts]) => {
        setMe(m);
        setTickets(ts.tickets ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <PortalShell>
      {loading || !me ? (
        <div className="flex items-center gap-2 text-navy-500"><Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}</div>
      ) : (
        <>
          <header className="mb-8">
            <p className="text-sm text-navy-500">{t("welcome")}</p>
            <h1 className="font-display text-3xl text-navy-900">{me.contact.full_name}</h1>
          </header>

          <section className="grid gap-5 lg:grid-cols-3">
            <div className="card lg:col-span-2">
              <p className="text-xs uppercase tracking-wider text-navy-500">{t("yourAccount")}</p>
              <h2 className="mt-1 font-display text-2xl text-navy-900">{me.customer.name}</h2>
              {me.customer.industry && <p className="mt-1 text-sm text-navy-600">{me.customer.industry}</p>}

              {me.customer.services_used.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs uppercase tracking-wider text-navy-500">{t("servicesContracted")}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {me.customer.services_used.map((s) => (
                      <span key={s} className="inline-flex items-center gap-1 rounded-full bg-accent-50 px-2.5 py-1 text-xs text-accent-800">
                        <CheckCircle2 className="h-3 w-3" />
                        {s.replace(/-/g, " ")}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {me.customer.notes && (
                <p className="mt-4 rounded-lg bg-navy-50 p-3 text-sm text-navy-700">{me.customer.notes}</p>
              )}
            </div>

            <div className="card">
              <p className="text-xs uppercase tracking-wider text-navy-500">{t("accountManager")}</p>
              {me.customer.account_manager_name ? (
                <>
                  <p className="mt-1 font-medium text-navy-900">{me.customer.account_manager_name}</p>
                  {me.customer.account_manager_email && (
                    <a href={`mailto:${me.customer.account_manager_email}`} className="mt-2 flex items-center gap-1.5 text-sm text-navy-700 hover:text-accent-700">
                      <Mail className="h-3.5 w-3.5" /> {me.customer.account_manager_email}
                    </a>
                  )}
                </>
              ) : (
                <p className="mt-1 text-sm text-navy-500">{t("noManager")}</p>
              )}
              <a href="mailto:hello@f2.co.th" className="mt-4 flex items-center gap-1.5 text-sm text-navy-700 hover:text-accent-700">
                <Mail className="h-3.5 w-3.5" /> hello@f2.co.th
              </a>
            </div>
          </section>

          <section className="mt-10">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-xl text-navy-900">{t("recentTickets")}</h2>
                <p className="text-sm text-navy-500">{t("ticketsTotal", { count: tickets.length })}</p>
              </div>
              <Link href="/portal/tickets/new" className="btn-accent">
                <Plus className="h-4 w-4" /> {t("newTicket")}
              </Link>
            </div>

            <div className="mt-4 card divide-y divide-navy-100 p-0">
              {tickets.length === 0 ? (
                <div className="p-6 text-center text-sm text-navy-500">
                  <Inbox className="mx-auto mb-2 h-6 w-6 text-navy-300" />
                  {t("noTickets")}
                </div>
              ) : (
                tickets.slice(0, 8).map((tk) => (
                  <Link
                    key={tk.id}
                    href={`/portal/tickets/${tk.id}` as any}
                    className="flex items-start justify-between gap-3 p-4 hover:bg-navy-50"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-navy-900 truncate">{tk.subject}</p>
                      <p className="mt-1 text-xs text-navy-500">
                        {new Date(tk.last_activity_at).toLocaleString()}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${statusColor[tk.status]}`}>{tc(`ticketStatus.${tk.status}`)}</span>
                  </Link>
                ))
              )}
            </div>
            {tickets.length > 8 && (
              <Link href="/portal/tickets" className="mt-3 inline-flex items-center gap-1 text-sm text-accent-700 hover:text-accent-900">
                {t("viewAllTickets")} <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </section>
        </>
      )}
    </PortalShell>
  );
}
