"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Loader2, ShieldCheck } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { adminApi, type DSR, type DSRStatus } from "@/lib/admin-api";

const DSR_STATUSES: Array<DSRStatus | "all"> = [
  "all", "pending", "in_progress", "completed", "rejected", "withdrawn",
];

const statusColor: Record<DSRStatus, string> = {
  pending: "bg-amber-50 text-amber-800",
  in_progress: "bg-blue-50 text-blue-800",
  completed: "bg-emerald-50 text-emerald-800",
  rejected: "bg-red-50 text-red-800",
  withdrawn: "bg-navy-100 text-navy-700",
};

export default function AdminDSRPage() {
  const t = useTranslations("admin.dsr");
  const tc = useTranslations("common");
  const [dsrs, setDsrs] = useState<DSR[]>([]);
  const [filter, setFilter] = useState<DSRStatus | "all">("all");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const data = await adminApi.listDSRs(filter === "all" ? undefined : filter);
      setDsrs(Array.isArray(data) ? data : []);
    } catch {
      setDsrs([]);
    } finally {
      setLoading(false);
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [filter]);

  const overdue = dsrs.filter(
    (d) => (d.status === "pending" || d.status === "in_progress") && new Date(d.due_date) < new Date(),
  ).length;

  return (
    <AdminShell>
      <header className="mb-6">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-accent-700" />
          <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
        </div>
        <p className="mt-1 text-sm text-navy-600">{t("subtitle")}</p>
        {overdue > 0 && (
          <p className="mt-2 text-sm font-medium text-red-600">
            ⚠ {t("overdueWarning", { count: overdue })}
          </p>
        )}
      </header>

      {/* Status filter tabs */}
      <div className="mb-4 flex flex-wrap gap-2">
        {DSR_STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded-full px-3 py-1 text-xs ${
              filter === s
                ? "bg-navy-900 text-white"
                : "bg-navy-100 text-navy-700 hover:bg-navy-200"
            }`}
          >
            {s === "all" ? tc("all") : t(`status.${s}`)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-navy-500">
          <Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}
        </div>
      ) : dsrs.length === 0 ? (
        <div className="card text-center text-navy-500">
          <ShieldCheck className="mx-auto mb-2 h-6 w-6 text-navy-300" />
          {filter === "all" ? t("noneAll") : t("noneFiltered")}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-navy-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-navy-200 bg-navy-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-navy-600">{t("col.requester")}</th>
                <th className="px-4 py-3 text-left font-medium text-navy-600">{t("col.type")}</th>
                <th className="px-4 py-3 text-left font-medium text-navy-600">{t("col.status")}</th>
                <th className="px-4 py-3 text-left font-medium text-navy-600">{t("col.due")}</th>
                <th className="px-4 py-3 text-left font-medium text-navy-600">{t("col.submitted")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {dsrs.map((d) => {
                const due = new Date(d.due_date);
                const isOverdue =
                  (d.status === "pending" || d.status === "in_progress") && due < new Date();
                return (
                  <tr key={d.id} className="hover:bg-navy-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/dsr/${d.id}` as any}
                        className="text-accent-700 hover:underline font-medium"
                      >
                        {d.requester_name}
                      </Link>
                      <p className="text-xs text-navy-500">{d.requester_email}</p>
                    </td>
                    <td className="px-4 py-3 text-navy-700">
                      {t(`type.${d.request_type}`)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${statusColor[d.status]}`}>
                        {t(`status.${d.status}`)}
                      </span>
                    </td>
                    <td className={`px-4 py-3 text-xs ${isOverdue ? "text-red-600 font-semibold" : "text-navy-600"}`}>
                      {due.toLocaleDateString()}
                      {isOverdue && " ⚠"}
                    </td>
                    <td className="px-4 py-3 text-xs text-navy-500">
                      {new Date(d.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}
