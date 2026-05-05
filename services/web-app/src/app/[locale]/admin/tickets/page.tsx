"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Loader2, Inbox, AlertCircle } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { adminApi, type AdminTicket, type TicketStats } from "@/lib/admin-api";

const statuses = ["all", "open", "in_progress", "waiting_customer", "resolved", "closed"] as const;
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
  urgent: "text-red-700 font-semibold",
};

export default function AdminTicketsQueuePage() {
  const t = useTranslations("admin.tickets");
  const tc = useTranslations("common");
  const [tickets, setTickets] = useState<AdminTicket[]>([]);
  const [stats, setStats] = useState<TicketStats | null>(null);
  const [filter, setFilter] = useState<typeof statuses[number]>("all");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [tk, s] = await Promise.all([
        adminApi.listAdminTickets(filter === "all" ? undefined : filter),
        adminApi.ticketStats(),
      ]);
      setTickets(tk.tickets ?? []);
      setStats(s);
    } catch {} finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  return (
    <AdminShell>
      <header className="mb-6">
        <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-navy-600">{t("subtitle")}</p>
      </header>

      {stats && (
        <div className="grid gap-4 sm:grid-cols-4 mb-6">
          <Tile label={t("tiles.open")} value={stats.open} />
          <Tile label={t("tiles.inProgress")} value={stats.in_progress} />
          <Tile label={t("tiles.waiting")} value={stats.waiting_customer} />
          <Tile label={t("tiles.urgent")} value={stats.urgent_open} accent />
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {statuses.map((s) => (
          <button key={s} onClick={() => setFilter(s)}
            className={`rounded-full px-3 py-1 text-xs ${
              filter === s ? "bg-navy-900 text-white" : "bg-navy-100 text-navy-700 hover:bg-navy-200"
            }`}>
            {tc(`ticketStatus.${s}`)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-navy-500"><Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}</div>
      ) : tickets.length === 0 ? (
        <div className="card text-center text-navy-500">
          <Inbox className="mx-auto mb-2 h-6 w-6 text-navy-300" />
          {filter === "all" ? t("noneAll") : t("noneFiltered", { status: tc(`ticketStatus.${filter}`) })}
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-navy-50 text-left text-xs uppercase tracking-wider text-navy-500">
              <tr>
                <th className="px-4 py-3 font-semibold">{t("table.subject")}</th>
                <th className="px-4 py-3 font-semibold">{t("table.customer")}</th>
                <th className="px-4 py-3 font-semibold">{t("table.priority")}</th>
                <th className="px-4 py-3 font-semibold">{t("table.status")}</th>
                <th className="px-4 py-3 font-semibold">{t("table.assignee")}</th>
                <th className="px-4 py-3 font-semibold">{t("table.updated")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {tickets.map((tk) => (
                <tr key={tk.id} className="hover:bg-navy-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/tickets/${tk.id}` as any} className="font-medium text-navy-900 hover:text-accent-700">
                      {tk.subject}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-navy-700">{tk.customer_name ?? "—"}</td>
                  <td className={`px-4 py-3 text-xs ${priorityColor[tk.priority]}`}>
                    {tk.priority === "urgent" && <AlertCircle className="inline h-3.5 w-3.5 mr-1" />}
                    {tc(`priority.${tk.priority}`)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${statusColor[tk.status]}`}>{tc(`ticketStatus.${tk.status}`)}</span>
                  </td>
                  <td className="px-4 py-3 text-navy-700 text-xs">{tk.assigned_to_name ?? "—"}</td>
                  <td className="px-4 py-3 text-navy-500 text-xs">{new Date(tk.last_activity_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}

function Tile({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={`card ${accent ? "border-red-200 bg-red-50/50" : ""}`}>
      <p className="text-xs uppercase tracking-wider text-navy-500">{label}</p>
      <p className={`mt-1 font-display text-3xl ${accent && value > 0 ? "text-red-700" : "text-navy-900"}`}>{value}</p>
    </div>
  );
}
