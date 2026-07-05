"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Loader2, Layers, Plus } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { adminApi, type AdminService } from "@/lib/admin-api";

export default function AdminServicesPage() {
  const t = useTranslations("admin.services");
  const tc = useTranslations("common");
  const [services, setServices] = useState<AdminService[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi.listAdminServices()
      .then((d) => setServices(d.services ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <AdminShell>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Layers className="h-6 w-6 text-accent-700" />
            <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
          </div>
          <p className="mt-1 text-sm text-navy-600">{t("subtitle", { total: services.length })}</p>
        </div>
        <Link href="/admin/services/new" className="btn-accent shrink-0 flex items-center gap-1.5">
          <Plus className="h-4 w-4" /> {t("newService")}
        </Link>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-navy-500">
          <Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}
        </div>
      ) : services.length === 0 ? (
        <div className="card text-center text-navy-500">
          <Layers className="mx-auto mb-2 h-6 w-6 text-navy-300" />
          <p>{t("noneYet")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-navy-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-navy-200 bg-navy-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-navy-600">{t("col.title")}</th>
                <th className="px-4 py-3 text-left font-medium text-navy-600">{t("col.slug")}</th>
                <th className="px-4 py-3 text-left font-medium text-navy-600">{t("col.category")}</th>
                <th className="px-4 py-3 text-left font-medium text-navy-600">{t("col.order")}</th>
                <th className="px-4 py-3 text-left font-medium text-navy-600">{t("col.status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {services.map((s) => (
                <tr key={s.id} className="hover:bg-navy-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/services/${s.slug}` as any}
                      className="font-medium text-accent-700 hover:underline"
                    >
                      {s.title.en || "(no title)"}
                    </Link>
                    {s.title.th && <p className="text-xs text-navy-500">{s.title.th}</p>}
                  </td>
                  <td className="px-4 py-3 text-navy-600 font-mono text-xs">{s.slug}</td>
                  <td className="px-4 py-3 text-navy-500 text-xs">{s.category}</td>
                  <td className="px-4 py-3 text-navy-500 text-xs">{s.sort_order}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${
                      s.is_published
                        ? "bg-emerald-50 text-emerald-800"
                        : "bg-amber-50 text-amber-800"
                    }`}>
                      {s.is_published ? t("status.published") : t("status.draft")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}
