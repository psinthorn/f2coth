"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { Link } from "@/i18n/routing";
import {
  ArrowLeft, Loader2, AlertTriangle, Send, Save, Lock,
} from "lucide-react";
import AdminShell from "@/components/AdminShell";
import {
  adminApi, type AdminTicket, type AdminTicketMessage, type User,
} from "@/lib/admin-api";
import AttachmentUploader from "@/components/attachments/AttachmentUploader";
import AttachmentList from "@/components/attachments/AttachmentList";
import { adminAttachments } from "@/lib/attachments-api";

const statuses = ["open", "in_progress", "waiting_customer", "resolved", "closed"];
const priorities = ["low", "normal", "high", "urgent"];
const statusColor: Record<string, string> = {
  open: "bg-accent-50 text-accent-800",
  in_progress: "bg-blue-50 text-blue-800",
  waiting_customer: "bg-amber-50 text-amber-800",
  resolved: "bg-emerald-50 text-emerald-800",
  closed: "bg-navy-100 text-navy-700",
};

export default function AdminTicketDetailPage() {
  const t = useTranslations("admin.tickets.detail");
  const tc = useTranslations("common");
  const ta = useTranslations("attachments");
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [ticket, setTicket] = useState<AdminTicket | null>(null);
  const [messages, setMessages] = useState<AdminTicketMessage[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attachTick, setAttachTick] = useState(0);
  const [replyMsgId, setReplyMsgId] = useState<string | null>(null);

  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [assignee, setAssignee] = useState("");
  const [savingMeta, setSavingMeta] = useState(false);

  async function load() {
    if (!id) return;
    setLoading(true);
    try {
      const [tk, m, u] = await Promise.all([
        adminApi.getAdminTicket(id),
        adminApi.listAdminTicketMessages(id),
        adminApi.listUsers().catch(() => ({ users: [] as User[] })),
      ]);
      setTicket(tk);
      setMessages(m.messages ?? []);
      setUsers(u.users ?? []);
      setStatus(tk.status);
      setPriority(tk.priority);
      setAssignee(tk.assigned_to_user_id ?? "");
    } catch (e: any) {
      setErr(tryMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  async function send() {
    if (!id || !reply.trim()) return;
    setBusy(true);
    setErr("");
    try {
      const res = await adminApi.addAdminTicketMessage(id, reply.trim(), internal);
      setReply("");
      setInternal(false);
      setReplyMsgId(res.id);
      await load();
    } catch (e: any) {
      setErr(tryMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveMeta() {
    if (!id) return;
    setSavingMeta(true);
    setErr("");
    try {
      await adminApi.updateAdminTicket(id, {
        status,
        priority,
        assigned_to_user_id: assignee,
      });
      await load();
    } catch (e: any) {
      setErr(tryMsg(e));
    } finally {
      setSavingMeta(false);
    }
  }

  return (
    <AdminShell>
      <Link href="/admin/tickets" className="inline-flex items-center gap-1 text-sm text-navy-600 hover:text-accent-700">
        <ArrowLeft className="h-3.5 w-3.5" /> {t("back")}
      </Link>

      {loading ? (
        <div className="mt-6 flex items-center gap-2 text-navy-500"><Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}</div>
      ) : !ticket ? (
        <div className="mt-6 card text-navy-500">{tc("notFound")}</div>
      ) : (
        <>
          <header className="mt-4 mb-6">
            <h1 className="font-display text-2xl text-navy-900">{ticket.subject}</h1>
            <p className="mt-1 text-sm text-navy-500">
              {ticket.customer_name} · {new Date(ticket.created_at).toLocaleString()}
              {ticket.opened_by_name && ` · ${t("openedBy", { name: ticket.opened_by_name })}`}
            </p>
          </header>

          {err && (
            <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
              <AlertTriangle className="mt-0.5 h-4 w-4" /><span>{err}</span>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-3">
              <div className="card">
                <div className="mb-2 text-sm font-medium text-navy-800">{ta("title")}</div>
                <AttachmentList
                  ownerType="ticket"
                  ownerId={id!}
                  client={adminAttachments}
                  canDelete
                  refreshKey={attachTick}
                />
                <div className="mt-3">
                  <AttachmentUploader
                    ownerType="ticket"
                    ownerId={id!}
                    client={adminAttachments}
                    onUploaded={() => setAttachTick((n) => n + 1)}
                    compact
                  />
                </div>
              </div>

              {messages.map((m) => (
                <div key={m.id}
                  className={`card ${
                    m.internal ? "border-amber-200 bg-amber-50" :
                    m.author_kind === "staff" ? "border-l-4 border-accent-500" : ""
                  }`}>
                  <div className="flex items-center justify-between text-xs text-navy-500">
                    <span>
                      <span className="font-medium text-navy-900">{m.author_name}</span>{" "}
                      <span className="rounded-full bg-navy-100 px-2 py-0.5 text-[10px] text-navy-700 capitalize">{m.author_kind}</span>
                      {m.internal && (
                        <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">
                          <Lock className="h-2.5 w-2.5" /> {t("internalBadge")}
                        </span>
                      )}
                    </span>
                    <span>{new Date(m.created_at).toLocaleString()}</span>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm text-navy-800">{m.body}</p>
                  <div className="mt-2">
                    <AttachmentList ownerType="ticket_message" ownerId={m.id} client={adminAttachments} canDelete />
                  </div>
                </div>
              ))}

              {ticket.status !== "closed" && (
                <div className="card mt-4 space-y-3">
                  {replyMsgId && (
                    <div className="rounded-lg border border-navy-100 bg-navy-50/50 p-3">
                      <div className="mb-1.5 text-xs font-medium text-navy-700">{ta("title")}</div>
                      <AttachmentUploader
                        ownerType="ticket_message"
                        ownerId={replyMsgId}
                        client={adminAttachments}
                        compact
                      />
                    </div>
                  )}
                  <textarea
                    value={reply} onChange={(e) => setReply(e.target.value)}
                    rows={4} maxLength={10000}
                    placeholder={t("replyPlaceholder")}
                    className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
                      {t("internalNote")}
                    </label>
                    <button onClick={send} disabled={busy || !reply.trim()} className="btn-accent">
                      {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("sending")}</> : <><Send className="h-4 w-4" /> {t("send")}</>}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <aside className="space-y-4">
              <section className="card">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-navy-500">{t("manage")}</h3>
                <div className="mt-3 flex flex-col gap-2">
                  <span className={`self-start rounded-full px-2 py-0.5 text-xs ${statusColor[ticket.status]}`}>{tc(`ticketStatus.${ticket.status}`)}</span>
                  <select value={status} onChange={(e) => setStatus(e.target.value)}
                    className="rounded-lg border border-navy-200 px-3 py-2 text-sm">
                    {statuses.map((s) => <option key={s} value={s}>{tc(`ticketStatus.${s}`)}</option>)}
                  </select>
                  <select value={priority} onChange={(e) => setPriority(e.target.value)}
                    className="rounded-lg border border-navy-200 px-3 py-2 text-sm">
                    {priorities.map((p) => <option key={p} value={p}>{tc(`priority.${p}`)}</option>)}
                  </select>
                  <select value={assignee} onChange={(e) => setAssignee(e.target.value)}
                    className="rounded-lg border border-navy-200 px-3 py-2 text-sm">
                    <option value="">{t("unassigned")}</option>
                    {users.filter((u) => u.is_active).map((u) => (
                      <option key={u.id} value={u.id}>{u.full_name}</option>
                    ))}
                  </select>
                  <button onClick={saveMeta} disabled={savingMeta} className="btn-accent">
                    {savingMeta ? <><Loader2 className="h-4 w-4 animate-spin" /> {tc("saving")}</> : <><Save className="h-4 w-4" /> {tc("save")}</>}
                  </button>
                </div>
              </section>

              <section className="card text-sm text-navy-700 space-y-1">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-navy-500">{t("customer")}</h3>
                <p className="font-medium text-navy-900">{ticket.customer_name}</p>
                <Link href={`/admin/customers/${ticket.customer_id}` as any} className="text-accent-700 hover:text-accent-900 text-xs">
                  {t("viewCustomer")}
                </Link>
                {ticket.related_service_slug && (
                  <p className="mt-2 text-xs text-navy-500">{t("relatedService")} <span className="text-navy-900">{ticket.related_service_slug}</span></p>
                )}
              </section>
            </aside>
          </div>
        </>
      )}
    </AdminShell>
  );
}

function tryMsg(e: any): string {
  if (!e) return "error";
  if (e.body) {
    try { return (JSON.parse(e.body) as { error?: string }).error ?? e.body; } catch { return e.body; }
  }
  return e.message ?? "error";
}
