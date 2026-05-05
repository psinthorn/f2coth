"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Inbox, FolderOpen, Trophy, Loader2, ArrowRight } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { adminApi, type Activity, type LeadStats } from "@/lib/admin-api";

export default function AdminDashboardPage() {
  const t = useTranslations("admin.dashboard");
  const tc = useTranslations("common");
  const [stats, setStats] = useState<LeadStats | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([adminApi.leadStats(), adminApi.recentActivities()])
      .then(([s, a]) => {
        setStats(s);
        setActivities(a.activities ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <AdminShell>
      <header className="mb-8">
        <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-navy-600">{t("subtitle")}</p>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-navy-500"><Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}</div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Tile icon={<Inbox className="h-5 w-5 text-accent-700" />}
                  label={t("tiles.newLeads")}
                  hint={t("tiles.newLeadsHint")}
                  value={stats?.new_last_7_days ?? 0}
                  href="/admin/leads" />
            <Tile icon={<FolderOpen className="h-5 w-5 text-accent-700" />}
                  label={t("tiles.openLeads")}
                  hint={t("tiles.openLeadsHint")}
                  value={stats?.open_leads ?? 0}
                  href="/admin/leads" />
            <Tile icon={<Trophy className="h-5 w-5 text-accent-700" />}
                  label={t("tiles.won")}
                  hint={t("tiles.wonHint")}
                  value={stats?.won_last_30_days ?? 0}
                  href="/admin/leads" />
          </div>

          <section className="mt-10">
            <h2 className="font-display text-xl text-navy-900">{t("recentActivity")}</h2>
            <div className="mt-4 card divide-y divide-navy-100">
              {activities.length === 0 ? (
                <p className="text-sm text-navy-500">{t("noActivity")}</p>
              ) : (
                activities.map((a) => <ActivityRow key={a.id} a={a} />)
              )}
            </div>
          </section>
        </>
      )}
    </AdminShell>
  );
}

function Tile({ icon, label, hint, value, href }: {
  icon: React.ReactNode; label: string; hint: string; value: number; href: string;
}) {
  return (
    <Link href={href} className="card group">
      <div className="flex items-center justify-between">
        {icon}
        <ArrowRight className="h-4 w-4 text-navy-300 group-hover:text-accent-700" />
      </div>
      <p className="mt-3 text-sm text-navy-600">{label}</p>
      <p className="mt-1 font-display text-4xl text-navy-900">{value}</p>
      <p className="mt-1 text-xs text-navy-500">{hint}</p>
    </Link>
  );
}

function ActivityRow({ a }: { a: Activity }) {
  const verb =
    a.activity_type === "status_change"
      ? `changed status: ${(a.payload as any).from} → ${(a.payload as any).to}`
      : a.activity_type === "note"
      ? `added a note: "${String((a.payload as any).note ?? "").slice(0, 80)}${String((a.payload as any).note ?? "").length > 80 ? "…" : ""}"`
      : `${a.activity_type}`;

  return (
    <Link href={`/admin/leads/${a.lead_id}`} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 hover:bg-navy-50 -mx-2 px-2 rounded">
      <div className="flex items-center justify-between text-sm">
        <span className="text-navy-700">
          <span className="font-medium">{a.actor_name ?? "System"}</span>{" "}
          <span className="text-navy-500">{verb}</span>
        </span>
        <span className="text-xs text-navy-400">{new Date(a.created_at).toLocaleString()}</span>
      </div>
    </Link>
  );
}
