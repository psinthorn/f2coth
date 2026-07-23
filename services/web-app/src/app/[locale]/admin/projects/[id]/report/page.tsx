"use client";

import { use, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Loader2, ChevronLeft, Printer, Mail } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { toast } from "@/lib/toast";
import { checklistApi, type Report } from "@/lib/checklist-api";

export default function AdminProjectReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <AdminShell>
      <ReportView projectId={id} />
    </AdminShell>
  );
}

function ReportView({ projectId }: { projectId: string }) {
  const t = useTranslations("admin.projects");
  const tc = useTranslations("common");
  const [range, setRange] = useState<"weekly" | "monthly">("weekly");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);

  const sendSummary = async () => {
    if (sending) return; // guard double-click while the first send is in flight
    setSending(true);
    setSendResult(null);
    try {
      const r = await checklistApi.sendWeeklySummary(projectId, date);
      setSendResult(`Sent to ${r.sent_to}`);
      toast.success(tc("toast.sent"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      setSendResult(msg);
      toast.error(msg);
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    checklistApi.getReport(projectId, range, date)
      .then(setReport)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId, range, date]);

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4 print:hidden">
        <div>
          <Link href={`/admin/projects/${projectId}` as any} className="mb-2 inline-flex items-center gap-1 text-sm text-navy-600 hover:text-navy-900">
            <ChevronLeft className="h-4 w-4" /> {t("board.backToBoard")}
          </Link>
          <h1 className="font-display text-3xl text-navy-900">{t("report.title")}</h1>
        </div>
        <div className="flex gap-2">
          <select value={range} onChange={(e) => setRange(e.target.value as "weekly" | "monthly")} className="rounded-lg border border-navy-200 px-3 py-2 text-sm">
            <option value="weekly">{t("report.weekly")}</option>
            <option value="monthly">{t("report.monthly")}</option>
          </select>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-navy-200 px-3 py-2 text-sm" />
          <button onClick={() => window.print()} className="inline-flex items-center gap-1 rounded-lg border border-navy-200 px-3 py-2 text-sm hover:bg-navy-50">
            <Printer className="h-4 w-4" /> {t("report.print")}
          </button>
          {range === "weekly" && (
            <button
              onClick={sendSummary}
              disabled={sending}
              className="inline-flex items-center gap-1 rounded-lg bg-accent-500 px-3 py-2 text-sm text-white hover:bg-accent-600 disabled:opacity-50"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              {t("report.sendWeekly")}
            </button>
          )}
        </div>
        {sendResult && <p className="mt-2 w-full text-xs text-navy-600">{sendResult}</p>}
      </header>

      {loading || !report ? (
        <div className="flex items-center gap-2 text-navy-500"><Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}</div>
      ) : (
        <article className="card space-y-6 print:shadow-none print:border-0">
          <section>
            <h2 className="font-display text-xl text-navy-900">{t("report.summary")}</h2>
            <p className="text-sm text-navy-600">
              {report.from_date.slice(0, 10)} → {report.to_date.slice(0, 10)}
            </p>
          </section>

          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={t("report.total")} value={report.totals.total} />
            <Stat label={t("report.pass")} value={report.totals.pass} tone="emerald" />
            <Stat label={t("report.fail")} value={report.totals.fail} tone="red" />
            <Stat label={t("report.pending")} value={report.totals.pending} />
          </section>

          <section>
            <h3 className="font-medium text-navy-900">{t("report.changes")}</h3>
            {report.items.length === 0 ? (
              <p className="text-sm text-navy-500">{t("report.noChanges")}</p>
            ) : (
              <ul className="mt-2 divide-y divide-navy-100">
                {report.items.map((it) => (
                  <li key={it.item_id} className="py-2">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-xs text-navy-400">{it.code}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${statusPill(it.status)}`}>{it.status}</span>
                      <span className="text-xs text-navy-400">{new Date(it.checked_at).toLocaleDateString()}</span>
                    </div>
                    <p className="text-sm text-navy-800">{it.text_en}</p>
                    <p className="text-xs text-navy-500">{it.text_th}</p>
                    {it.note && <p className="mt-1 text-xs text-navy-600">— {it.note}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="font-medium text-navy-900">{t("report.visits")}</h3>
            {report.visits.length === 0 ? (
              <p className="text-sm text-navy-500">{t("report.noVisits")}</p>
            ) : (
              <ul className="mt-2 divide-y divide-navy-100">
                {report.visits.map((v) => (
                  <li key={v.id} className="py-2">
                    <div className="flex items-baseline gap-2">
                      <p className="text-sm text-navy-800">{v.visit_date}</p>
                      {v.billable && <span className="rounded-full bg-accent-50 px-2 py-0.5 text-xs text-accent-800">{t("report.billable")}</span>}
                    </div>
                    {v.summary && <p className="text-sm text-navy-600">{v.summary}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </article>
      )}
    </div>
  );
}

function Stat({ label, value, tone = "navy" }: { label: string; value: number; tone?: "navy" | "emerald" | "red" }) {
  const bg = tone === "emerald" ? "bg-emerald-50 text-emerald-800" : tone === "red" ? "bg-red-50 text-red-800" : "bg-navy-50 text-navy-700";
  return (
    <div className={`rounded-lg p-3 ${bg}`}>
      <p className="text-xs uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-medium">{value}</p>
    </div>
  );
}

function statusPill(s: string) {
  switch (s) {
    case "pass": return "bg-emerald-50 text-emerald-800";
    case "fail": return "bg-red-50 text-red-800";
    case "na": return "bg-navy-100 text-navy-600";
    default: return "bg-navy-50 text-navy-500";
  }
}
