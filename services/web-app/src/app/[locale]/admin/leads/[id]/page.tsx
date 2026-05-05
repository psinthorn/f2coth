"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { Link } from "@/i18n/routing";
import { ArrowLeft, Loader2, Mail, Phone, Building2, MapPin, Send, AlertTriangle } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import {
  adminApi, type Lead, type Activity, type LeadStatus,
} from "@/lib/admin-api";

const statuses: LeadStatus[] = ["new", "contacted", "qualified", "won", "lost", "spam"];

export default function LeadDetailPage() {
  const t = useTranslations("admin.leads.detail");
  const tc = useTranslations("common");
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [lead, setLead] = useState<Lead | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>("");

  const [statusDraft, setStatusDraft] = useState<LeadStatus>("new");
  const [statusNote, setStatusNote] = useState("");
  const [savingStatus, setSavingStatus] = useState(false);

  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  async function load() {
    if (!id) return;
    setLoading(true);
    setErr("");
    try {
      const [l, a] = await Promise.all([
        adminApi.getLead(id),
        adminApi.listLeadActivities(id),
      ]);
      setLead(l);
      setStatusDraft(l.status);
      setActivities(a.activities ?? []);
    } catch (e: any) {
      setErr(e?.message ?? t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function saveStatus() {
    if (!lead) return;
    setSavingStatus(true);
    try {
      await adminApi.updateLeadStatus(lead.id, statusDraft, statusNote);
      setStatusNote("");
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "");
    } finally {
      setSavingStatus(false);
    }
  }

  async function addNote() {
    if (!lead || !note.trim()) return;
    setSavingNote(true);
    try {
      await adminApi.addLeadNote(lead.id, note.trim());
      setNote("");
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "");
    } finally {
      setSavingNote(false);
    }
  }

  return (
    <AdminShell>
      <Link href="/admin/leads" className="inline-flex items-center gap-1 text-sm text-navy-600 hover:text-accent-700">
        <ArrowLeft className="h-3.5 w-3.5" /> {t("back")}
      </Link>

      {loading ? (
        <div className="mt-6 flex items-center gap-2 text-navy-500"><Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}</div>
      ) : !lead ? (
        <div className="mt-6 card text-navy-500">{tc("notFound")}</div>
      ) : (
        <>
          <header className="mt-4 mb-6 flex items-start justify-between gap-4">
            <div>
              <h1 className="font-display text-3xl text-navy-900">{lead.full_name}</h1>
              <p className="mt-1 text-sm text-navy-600">{lead.email}</p>
            </div>
            <span className="rounded-full bg-accent-50 px-3 py-1 text-xs uppercase tracking-wider text-accent-800">
              {tc(`leadStatus.${lead.status}`)}
            </span>
          </header>

          {err && (
            <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
              <AlertTriangle className="mt-0.5 h-4 w-4" />
              <span>{err}</span>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-6">
              <section className="card">
                <h2 className="font-semibold text-navy-900">{t("enquiry")}</h2>
                <p className="mt-3 whitespace-pre-wrap text-sm text-navy-700">{lead.message}</p>
                {lead.interest.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-1">
                    {lead.interest.map((i) => (
                      <span key={i} className="rounded-full bg-navy-100 px-2 py-0.5 text-xs text-navy-700">{i}</span>
                    ))}
                  </div>
                )}
              </section>

              <section className="card">
                <h2 className="font-semibold text-navy-900">{t("addNote")}</h2>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  maxLength={5000}
                  placeholder={t("notePlaceholder")}
                  className="mt-3 w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
                />
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={addNote}
                    disabled={savingNote || !note.trim()}
                    className="btn-accent"
                  >
                    {savingNote ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("addingNote")}</> : <><Send className="h-4 w-4" /> {t("addNoteButton")}</>}
                  </button>
                </div>
              </section>

              <section className="card">
                <h2 className="font-semibold text-navy-900">{t("activity")}</h2>
                <div className="mt-4 space-y-3">
                  {activities.length === 0 ? (
                    <p className="text-sm text-navy-500">{t("noActivity")}</p>
                  ) : (
                    activities.map((a) => <ActivityItem key={a.id} a={a} />)
                  )}
                </div>
              </section>
            </div>

            <aside className="space-y-4">
              <section className="card">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-navy-500">{t("updateStatus")}</h3>
                <select
                  value={statusDraft}
                  onChange={(e) => setStatusDraft(e.target.value as LeadStatus)}
                  className="mt-3 w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
                >
                  {statuses.map((s) => <option key={s} value={s}>{tc(`leadStatus.${s}`)}</option>)}
                </select>
                <input
                  value={statusNote}
                  onChange={(e) => setStatusNote(e.target.value)}
                  placeholder={t("statusNote")}
                  className="mt-2 w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
                />
                <button
                  onClick={saveStatus}
                  disabled={savingStatus || (statusDraft === lead.status && !statusNote)}
                  className="mt-3 btn-accent w-full"
                >
                  {savingStatus ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("savingStatus")}</> : t("saveStatus")}
                </button>
              </section>

              <section className="card text-sm text-navy-700 space-y-2">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-navy-500">{t("contact")}</h3>
                <p className="flex items-start gap-2"><Mail className="mt-0.5 h-4 w-4 shrink-0 text-navy-400" /><a href={`mailto:${lead.email}`} className="hover:text-accent-700">{lead.email}</a></p>
                {lead.phone && <p className="flex items-start gap-2"><Phone className="mt-0.5 h-4 w-4 shrink-0 text-navy-400" /><a href={`tel:${lead.phone}`} className="hover:text-accent-700">{lead.phone}</a></p>}
                {lead.company && <p className="flex items-start gap-2"><Building2 className="mt-0.5 h-4 w-4 shrink-0 text-navy-400" />{lead.company}</p>}
                {lead.property_name && <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-navy-400" />{lead.property_name}{lead.property_type && <span className="text-navy-500"> ({lead.property_type})</span>}</p>}
              </section>

              <section className="card text-sm text-navy-700 space-y-1">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-navy-500">{t("source")}</h3>
                <p>{t("channel")} <span className="text-navy-900">{lead.source}</span></p>
                {lead.utm_source && <p>{t("utmSource")} <span className="text-navy-900">{lead.utm_source}</span></p>}
                {lead.utm_campaign && <p>{t("utmCampaign")} <span className="text-navy-900">{lead.utm_campaign}</span></p>}
                <p className="text-xs text-navy-500 mt-2">{t("submitted", { date: new Date(lead.created_at).toLocaleString() })}</p>
              </section>
            </aside>
          </div>
        </>
      )}
    </AdminShell>
  );
}

function ActivityItem({ a }: { a: Activity }) {
  const tc = useTranslations("common");
  const td = useTranslations("admin.dashboard.activity");
  const date = new Date(a.created_at).toLocaleString();
  if (a.activity_type === "status_change") {
    const p = a.payload as { from?: string; to?: string; note?: string };
    return (
      <div className="border-l-2 border-accent-200 pl-3 text-sm">
        <p className="text-navy-700">
          <span className="font-medium">{a.actor_name ?? td("system")}</span>{" "}
          <span className="text-navy-500">
            {td("statusChange", {
              from: p.from ? tc(`leadStatus.${p.from}` as any) : "—",
              to: p.to ? tc(`leadStatus.${p.to}` as any) : "—",
            })}
          </span>
        </p>
        {p.note && <p className="mt-1 text-navy-600 italic">"{p.note}"</p>}
        <p className="mt-1 text-xs text-navy-400">{date}</p>
      </div>
    );
  }
  if (a.activity_type === "note") {
    const p = a.payload as { note?: string };
    return (
      <div className="border-l-2 border-navy-200 pl-3 text-sm">
        <p className="text-navy-700"><span className="font-medium">{a.actor_name ?? td("system")}</span> ·</p>
        <p className="mt-1 whitespace-pre-wrap text-navy-700">{p.note}</p>
        <p className="mt-1 text-xs text-navy-400">{date}</p>
      </div>
    );
  }
  return (
    <div className="border-l-2 border-navy-200 pl-3 text-sm">
      <p className="text-navy-700"><span className="font-medium">{a.actor_name ?? td("system")}</span> · {a.activity_type}</p>
      <p className="text-xs text-navy-400">{date}</p>
    </div>
  );
}
