"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Loader2, Plus, Inbox } from "lucide-react";
import PortalShell from "@/components/PortalShell";
import { portalApi, type PortalTicket } from "@/lib/portal-api";

const statusColor: Record<string, string> = {
  open: "bg-accent-50 text-accent-800",
  in_progress: "bg-blue-50 text-blue-800",
  waiting_customer: "bg-amber-50 text-amber-800",
  resolved: "bg-emerald-50 text-emerald-800",
  closed: "bg-navy-100 text-navy-700",
};

const priorityColor: Record<string, string> = {
  low: "text-navy-500",
  normal: "text-navy-700",
  high: "text-amber-700",
  urgent: "text-red-700",
};

export default function TicketsListPage() {
  const t = useTranslations("portal.tickets");
  const tc = useTranslations("common");
  const [tickets, setTickets] = useState<PortalTicket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    portalApi.listTickets().then((d) => setTickets(d.tickets ?? [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <PortalShell>
      <header className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
          <p className="mt-1 text-sm text-navy-600">{t("totalCount", { count: tickets.length })}</p>
        </div>
        <Link href="/portal/tickets/new" className="btn-accent">
          <Plus className="h-4 w-4" /> {t("newButton")}
        </Link>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-navy-500"><Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}</div>
      ) : tickets.length === 0 ? (
        <div className="card text-center text-navy-500">
          <Inbox className="mx-auto mb-2 h-6 w-6 text-navy-300" />
          {t("noneYet")} <strong className="text-accent-700">{t("noneClickHere")}</strong> {t("noneSuffix")}
        </div>
      ) : (
        <div className="card divide-y divide-navy-100 p-0">
          {tickets.map((tk) => (
            <Link key={tk.id} href={`/portal/tickets/${tk.id}` as any} className="flex items-start justify-between gap-3 p-4 hover:bg-navy-50">
              <div className="min-w-0">
                <p className="font-medium text-navy-900 truncate">{tk.subject}</p>
                <p className="mt-1 text-xs text-navy-500">
                  <span className={priorityColor[tk.priority]}>{tc(`priority.${tk.priority}`)}</span>
                  {" · "}
                  {t("updated", { date: new Date(tk.last_activity_at).toLocaleString() })}
                  {tk.assigned_to_name && ` · ${t("assigned", { name: tk.assigned_to_name })}`}
                </p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${statusColor[tk.status]}`}>{tc(`ticketStatus.${tk.status}`)}</span>
            </Link>
          ))}
        </div>
      )}
    </PortalShell>
  );
}
