"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Loader2, Search } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { adminApi, type Lead, type LeadStatus } from "@/lib/admin-api";

const statuses: LeadStatus[] = ["new", "contacted", "qualified", "won", "lost", "spam"];
const statusColor: Record<LeadStatus, string> = {
  new: "bg-accent-50 text-accent-800",
  contacted: "bg-amber-50 text-amber-800",
  qualified: "bg-blue-50 text-blue-800",
  won: "bg-emerald-50 text-emerald-800",
  lost: "bg-navy-100 text-navy-700",
  spam: "bg-red-50 text-red-800",
};

export default function AdminLeadsPage() {
  const t = useTranslations("admin.leads");
  const tc = useTranslations("common");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<LeadStatus | "all">("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    adminApi.listLeads()
      .then((d) => setLeads(d.leads ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    return leads.filter((l) => {
      if (statusFilter !== "all" && l.status !== statusFilter) return false;
      if (query) {
        const q = query.toLowerCase();
        return (
          l.full_name.toLowerCase().includes(q) ||
          l.email.toLowerCase().includes(q) ||
          (l.property_name ?? "").toLowerCase().includes(q) ||
          (l.company ?? "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [leads, statusFilter, query]);

  return (
    <AdminShell>
      <header className="mb-6">
        <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-navy-600">{t("totalMatching", { total: leads.length, matching: filtered.length })}</p>
      </header>

      <div className="card mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-navy-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="w-full rounded-lg border border-navy-200 pl-9 pr-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as LeadStatus | "all")}
          className="rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
        >
          <option value="all">{tc("leadStatus.all")}</option>
          {statuses.map((s) => <option key={s} value={s}>{tc(`leadStatus.${s}`)}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-navy-500"><Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}</div>
      ) : filtered.length === 0 ? (
        <div className="card text-center text-navy-500">
          {leads.length === 0 ? t("noneYet") : t("noneMatching")}
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:hidden">
            {filtered.map((l) => (
              <Link key={l.id} href={`/admin/leads/${l.id}` as any} className="card">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-navy-900">{l.full_name}</p>
                    <p className="text-sm text-navy-600">{l.email}</p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${statusColor[l.status]}`}>{tc(`leadStatus.${l.status}`)}</span>
                </div>
                {l.property_name && <p className="mt-2 text-sm text-navy-700">{l.property_name}</p>}
                <p className="mt-2 text-xs text-navy-500">{new Date(l.created_at).toLocaleString()}</p>
              </Link>
            ))}
          </div>

          <div className="hidden md:block card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-navy-50 text-left text-xs uppercase tracking-wider text-navy-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">{t("table.name")}</th>
                  <th className="px-4 py-3 font-semibold">{t("table.email")}</th>
                  <th className="px-4 py-3 font-semibold">{t("table.property")}</th>
                  <th className="px-4 py-3 font-semibold">{t("table.source")}</th>
                  <th className="px-4 py-3 font-semibold">{t("table.status")}</th>
                  <th className="px-4 py-3 font-semibold">{t("table.created")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {filtered.map((l) => (
                  <tr key={l.id} className="hover:bg-navy-50">
                    <td className="px-4 py-3">
                      <Link href={`/admin/leads/${l.id}` as any} className="font-medium text-navy-900 hover:text-accent-700">
                        {l.full_name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-navy-600">{l.email}</td>
                    <td className="px-4 py-3 text-navy-700">{l.property_name ?? "—"}</td>
                    <td className="px-4 py-3 text-navy-600">{l.source}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${statusColor[l.status]}`}>{tc(`leadStatus.${l.status}`)}</span>
                    </td>
                    <td className="px-4 py-3 text-navy-500">{new Date(l.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </AdminShell>
  );
}
