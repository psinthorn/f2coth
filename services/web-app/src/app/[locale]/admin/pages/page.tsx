"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Loader2, FileCode, Plus } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { adminApi, type AdminPage } from "@/lib/admin-api";

export default function AdminPagesPage() {
  const t = useTranslations("admin.pages");
  const tc = useTranslations("common");
  const [pages, setPages] = useState<AdminPage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi.listAdminPages()
      .then((d) => setPages(d.pages ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <AdminShell>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FileCode className="h-6 w-6 text-accent-700" />
            <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
          </div>
          <p className="mt-1 text-sm text-navy-600">{t("subtitle", { total: pages.length })}</p>
        </div>
        <Link href="/admin/pages/new" className="btn-accent shrink-0 flex items-center gap-1.5">
          <Plus className="h-4 w-4" /> {t("newPage")}
        </Link>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-navy-500">
          <Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}
        </div>
      ) : pages.length === 0 ? (
        <div className="card text-center text-navy-500">
          <FileCode className="mx-auto mb-2 h-6 w-6 text-navy-300" />
          <p>{t("noneYet")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-navy-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-navy-200 bg-navy-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-navy-600">{t("col.title")}</th>
                <th className="px-4 py-3 text-left font-medium text-navy-600">{t("col.slug")}</th>
                <th className="px-4 py-3 text-left font-medium text-navy-600">{t("col.url")}</th>
                <th className="px-4 py-3 text-left font-medium text-navy-600">{t("col.status")}</th>
                <th className="px-4 py-3 text-left font-medium text-navy-600">{t("col.updated")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {pages.map((p) => (
                <tr key={p.id} className="hover:bg-navy-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/pages/${p.slug}` as any}
                      className="font-medium text-accent-700 hover:underline"
                    >
                      {p.title.en || "(no title)"}
                    </Link>
                    {p.title.th && <p className="text-xs text-navy-500">{p.title.th}</p>}
                  </td>
                  <td className="px-4 py-3 text-navy-600 font-mono text-xs">{p.slug}</td>
                  <td className="px-4 py-3 text-navy-500 font-mono text-xs">/{p.slug}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${
                      p.is_published
                        ? "bg-emerald-50 text-emerald-800"
                        : "bg-amber-50 text-amber-800"
                    }`}>
                      {p.is_published ? t("status.published") : t("status.draft")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-navy-500 text-xs">
                    {new Date(p.updated_at).toLocaleDateString()}
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
