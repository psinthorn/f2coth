"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { Link } from "@/i18n/routing";
import {
  ArrowLeft, Loader2, AlertTriangle, Send, CheckCircle2, RotateCcw,
} from "lucide-react";
import PortalShell from "@/components/PortalShell";
import { portalApi, type PortalTicket, type PortalMessage } from "@/lib/portal-api";

const statusColor: Record<string, string> = {
  open: "bg-accent-50 text-accent-800",
  in_progress: "bg-blue-50 text-blue-800",
  waiting_customer: "bg-amber-50 text-amber-800",
  resolved: "bg-emerald-50 text-emerald-800",
  closed: "bg-navy-100 text-navy-700",
};

export default function TicketDetailPage() {
  const t = useTranslations("portal.tickets.detail");
  const tc = useTranslations("common");
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [ticket, setTicket] = useState<PortalTicket | null>(null);
  const [messages, setMessages] = useState<PortalMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    if (!id) return;
    setLoading(true);
    setErr("");
    try {
      const [tk, m] = await Promise.all([portalApi.getTicket(id), portalApi.listMessages(id)]);
      setTicket(tk);
      setMessages(m.messages ?? []);
    } catch (e: any) {
      setErr(e?.message ?? t("errorGeneric"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  async function send() {
    if (!id || !reply.trim()) return;
    setBusy(true);
    try {
      await portalApi.addMessage(id, reply.trim());
      setReply("");
      await load();
    } catch (e: any) {
      setErr(e?.message ?? t("errorReply"));
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: "resolved" | "open") {
    if (!id) return;
    setBusy(true);
    try {
      await portalApi.setStatus(id, status);
      await load();
    } catch (e: any) {
      setErr(e?.message ?? t("errorStatus"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PortalShell>
      <Link href="/portal/tickets" className="inline-flex items-center gap-1 text-sm text-navy-600 hover:text-accent-700">
        <ArrowLeft className="h-3.5 w-3.5" /> {t("back")}
      </Link>

      {loading ? (
        <div className="mt-6 flex items-center gap-2 text-navy-500"><Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}</div>
      ) : !ticket ? (
        <div className="mt-6 card text-navy-500">{tc("notFound")}</div>
      ) : (
        <>
          <header className="mt-4 mb-6 flex items-start justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl text-navy-900">{ticket.subject}</h1>
              <p className="mt-1 text-sm text-navy-500">
                {t("openedAt", {
                  priority: tc(`priority.${ticket.priority}`),
                  date: new Date(ticket.created_at).toLocaleString(),
                })}
                {ticket.assigned_to_name && ` · ${t("assigned", { name: ticket.assigned_to_name })}`}
              </p>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs ${statusColor[ticket.status]}`}>{tc(`ticketStatus.${ticket.status}`)}</span>
          </header>

          {err && (
            <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
              <AlertTriangle className="mt-0.5 h-4 w-4" /><span>{err}</span>
            </div>
          )}

          <section className="space-y-3">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`card ${m.author_kind === "staff" ? "border-l-4 border-accent-500" : ""}`}
              >
                <div className="flex items-center justify-between text-xs text-navy-500">
                  <span>
                    <span className="font-medium text-navy-900">{m.author_name}</span>
                    {" "}<span className="rounded-full bg-navy-100 px-2 py-0.5 text-[10px] text-navy-700 capitalize">{m.author_kind}</span>
                  </span>
                  <span>{new Date(m.created_at).toLocaleString()}</span>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm text-navy-800">{m.body}</p>
              </div>
            ))}
          </section>

          {ticket.status !== "closed" && (
            <section className="mt-6 space-y-3">
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                rows={4}
                maxLength={10000}
                placeholder={t("replyPlaceholder")}
                className="w-full rounded-lg border border-navy-200 bg-white px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex gap-2">
                  {ticket.status !== "resolved" ? (
                    <button onClick={() => setStatus("resolved")} disabled={busy}
                      className="btn-ghost text-emerald-700 border-emerald-200 hover:bg-emerald-50">
                      <CheckCircle2 className="h-4 w-4" /> {t("markResolved")}
                    </button>
                  ) : (
                    <button onClick={() => setStatus("open")} disabled={busy}
                      className="btn-ghost">
                      <RotateCcw className="h-4 w-4" /> {t("reopen")}
                    </button>
                  )}
                </div>
                <button onClick={send} disabled={busy || !reply.trim()} className="btn-accent">
                  {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("sending")}</> : <><Send className="h-4 w-4" /> {t("sendReply")}</>}
                </button>
              </div>
            </section>
          )}
        </>
      )}
    </PortalShell>
  );
}
