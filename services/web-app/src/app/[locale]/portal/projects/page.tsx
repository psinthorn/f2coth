"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Loader2, ClipboardCheck } from "lucide-react";
import PortalShell from "@/components/PortalShell";
import { portalApi, type PortalProject } from "@/lib/portal-api";

export default function PortalProjectsPage() {
  const t = useTranslations("portal.projects");
  const tc = useTranslations("common");
  const [projects, setProjects] = useState<PortalProject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    portalApi.listMyProjects()
      .then((d) => setProjects(d.projects ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <PortalShell>
      <header className="mb-6">
        <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-navy-600">{t("subtitle")}</p>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-navy-500">
          <Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}
        </div>
      ) : projects.length === 0 ? (
        <div className="card text-center text-navy-500">
          <ClipboardCheck className="mx-auto mb-3 h-8 w-8 text-navy-300" />
          <p>{t("noneYet")}</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {projects.map((p) => <PortalProjectCard key={p.id} p={p} />)}
        </div>
      )}
    </PortalShell>
  );
}

function PortalProjectCard({ p }: { p: PortalProject }) {
  const t = useTranslations("portal.projects");
  const done = p.done_count ?? 0;
  const total = p.total_count ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <Link href={`/portal/projects/${p.id}` as any} className="card block hover:shadow-md transition-shadow">
      <h3 className="font-medium text-navy-900 truncate">{p.name}</h3>
      <span
        className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs ${
          p.status === "active" ? "bg-emerald-50 text-emerald-800"
            : p.status === "paused" ? "bg-amber-50 text-amber-800"
              : "bg-navy-100 text-navy-700"
        }`}
      >
        {t(`status.${p.status}`)}
      </span>
      <div className="mt-4">
        <div className="flex justify-between text-xs text-navy-600">
          <span>{t("progress")}</span>
          <span>{done} / {total}</span>
        </div>
        <div className="mt-1 h-2 rounded-full bg-navy-100 overflow-hidden">
          <div className="h-full bg-accent-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </Link>
  );
}
