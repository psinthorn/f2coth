"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { ArrowLeft, Loader2, AlertTriangle, Send, CheckCircle2, Paperclip } from "lucide-react";
import PortalShell from "@/components/PortalShell";
import { useBusyAction } from "@/lib/toast";
import { portalApi, type TicketPriority } from "@/lib/portal-api";
import AttachmentUploader from "@/components/attachments/AttachmentUploader";
import { portalAttachments } from "@/lib/attachments-api";

const priorities: TicketPriority[] = ["low", "normal", "high", "urgent"];

export default function NewTicketPage() {
  const t = useTranslations("portal.tickets.new");
  const tc = useTranslations("common");
  const ta = useTranslations("attachments");
  const router = useRouter();
  const { busy, run } = useBusyAction();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("normal");
  const [related, setRelated] = useState("");
  const [services, setServices] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [createdId, setCreatedId] = useState<string | null>(null);

  useEffect(() => {
    portalApi.me()
      .then((d) => setServices(d.customer.services_used))
      .catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const ok = await run(async () => {
      const res = await portalApi.createTicket({
        subject: subject.trim(),
        body: body.trim(),
        priority,
        related_service_slug: related || undefined,
      });
      // Attachments need the new ticket id, so surface an optional attach
      // step here rather than redirecting immediately.
      setCreatedId(res.id);
    }, { success: tc("toast.sent") });
    if (!ok) setErr(t("errorGeneric"));
  }

  return (
    <PortalShell>
      <Link href="/portal/tickets" className="inline-flex items-center gap-1 text-sm text-navy-600 hover:text-accent-700">
        <ArrowLeft className="h-3.5 w-3.5" /> {t("back")}
      </Link>

      <h1 className="mt-4 mb-6 font-display text-3xl text-navy-900">{t("title")}</h1>

      {createdId ? (
        <div className="card max-w-2xl space-y-4">
          <div className="flex items-start gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-800">
            <CheckCircle2 className="mt-0.5 h-4 w-4" />
            <span>{t("created")}</span>
          </div>
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-navy-800">
              <Paperclip className="h-4 w-4" /> {ta("title")}
            </div>
            <AttachmentUploader ownerType="ticket" ownerId={createdId} client={portalAttachments} />
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => router.push(`/portal/tickets/${createdId}` as any)}
              className="btn-accent"
            >
              {t("viewTicket")}
            </button>
          </div>
        </div>
      ) : (
      <form onSubmit={submit} className="card max-w-2xl space-y-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-navy-800">{t("subject")}</label>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required maxLength={200}
            placeholder={t("subjectPlaceholder")}
            className="rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-navy-800">{t("priority")}</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as TicketPriority)}
              className="rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
            >
              {priorities.map((p) => <option key={p} value={p}>{tc(`priority.${p}`)}</option>)}
            </select>
          </div>
          {services.length > 0 && (
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-navy-800">{t("relatedService")}</label>
              <select
                value={related}
                onChange={(e) => setRelated(e.target.value)}
                className="rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
              >
                <option value="">{t("noneOption")}</option>
                {services.map((s) => <option key={s} value={s}>{s.replace(/-/g, " ")}</option>)}
              </select>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-navy-800">{t("description")}</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required rows={8} maxLength={10000}
            placeholder={t("descriptionPlaceholder")}
            className="rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
          />
        </div>

        {err && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            <span>{err}</span>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Link href="/portal/tickets" className="btn-ghost">{tc("cancel")}</Link>
          <button type="submit" disabled={busy} className="btn-accent disabled:opacity-40">
            {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("submitting")}</> : <><Send className="h-4 w-4" /> {t("submit")}</>}
          </button>
        </div>
      </form>
      )}
    </PortalShell>
  );
}
