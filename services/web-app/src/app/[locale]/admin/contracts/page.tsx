"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Loader2, Plus, FileSignature, AlarmClock, Settings2 } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { contractApi, type Contract, type ContractStatus } from "@/lib/contract-api";
import {
  StatusBadge, ALL_STATUSES, formatTHB, formatDate, daysUntil, isExpiringSoon,
} from "./_shared";

export default function AdminContractsPage() {
  const t = useTranslations("admin.contracts");
  const tc = useTranslations("common");
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<ContractStatus | "">("");
  const [customerFilter, setCustomerFilter] = useState("");

  useEffect(() => {
    setLoading(true);
    contractApi.list(statusFilter ? { status: statusFilter } : {})
      .then((d) => setContracts(d.contracts ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [statusFilter]);

  const filtered = useMemo(() => {
    if (!customerFilter.trim()) return contracts;
    const q = customerFilter.toLowerCase();
    return contracts.filter((c) => (c.party_name ?? "").toLowerCase().includes(q));
  }, [contracts, customerFilter]);

  const expiringCount = useMemo(
    () => contracts.filter((c) => isExpiringSoon(c, 30)).length,
    [contracts],
  );

  return (
    <AdminShell>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
          <p className="mt-1 text-sm text-navy-600">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/contracts/templates"
            className="inline-flex items-center gap-2 rounded-lg border border-navy-200 px-3 py-2 text-sm font-medium text-navy-700 hover:bg-navy-50"
          >
            <Settings2 className="h-4 w-4" /> {t("templates.manage")}
          </Link>
          <Link
            href="/admin/contracts/new"
            className="inline-flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600"
          >
            <Plus className="h-4 w-4" /> {t("newContract")}
          </Link>
        </div>
      </header>

      {expiringCount > 0 && (
        <div className="mb-5 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlarmClock className="h-5 w-5 shrink-0" />
          <span>{t("expiringCard", { count: expiringCount })}</span>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ContractStatus | "")}
          className="rounded-lg border border-navy-200 px-3 py-2 text-sm text-navy-700"
        >
          <option value="">{t("filter.allStatuses")}</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>{t(`status.${s}`)}</option>
          ))}
        </select>
        <input
          value={customerFilter}
          onChange={(e) => setCustomerFilter(e.target.value)}
          placeholder={t("filter.customer")}
          className="rounded-lg border border-navy-200 px-3 py-2 text-sm text-navy-700"
        />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-navy-500">
          <Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center text-navy-500">
          <FileSignature className="mx-auto mb-3 h-8 w-8 text-navy-300" />
          <p>{t("noneYet")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-navy-100 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-navy-100 bg-navy-50 text-xs uppercase text-navy-500">
              <tr>
                <th className="px-4 py-3">{t("col.docNo")}</th>
                <th className="px-4 py-3">{t("col.customer")}</th>
                <th className="px-4 py-3">{t("col.status")}</th>
                <th className="px-4 py-3">{t("col.effective")}</th>
                <th className="px-4 py-3">{t("col.end")}</th>
                <th className="px-4 py-3 text-right">{t("col.fee")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-50">
              {filtered.map((c) => {
                const soon = isExpiringSoon(c, 30);
                const d = daysUntil(c.end_date);
                return (
                  <tr key={c.id} className={soon ? "bg-amber-50/60" : "hover:bg-navy-50/50"}>
                    <td className="px-4 py-3">
                      <Link href={`/admin/contracts/${c.id}`} className="font-medium text-accent-600 hover:underline">
                        {c.doc_no}
                      </Link>
                      <div className="text-xs text-navy-400">{c.template_name}</div>
                    </td>
                    <td className="px-4 py-3 text-navy-700">{c.party_name}</td>
                    <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                    <td className="px-4 py-3 text-navy-600">{formatDate(c.effective_date)}</td>
                    <td className="px-4 py-3 text-navy-600">
                      {formatDate(c.end_date)}
                      {soon && d !== null && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
                          {t("daysLeft", { days: d })}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-navy-700">{formatTHB(c.fee_total)}</td>
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
