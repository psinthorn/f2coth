"use client";

// ApprovalSection — the reusable "approval" panel embeddable in any admin
// section that needs customer sign-off. v1 is mounted on the ticket detail
// page; the same component drops into contracts / checklists later by passing a
// different subjectType. Flow: build a draft → attach files + pick recipient →
// send a magic-link → track the customer's decision.

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ClipboardCheck, Plus, Loader2, Send, RotateCcw, X, Trash2, Paperclip,
} from "lucide-react";
import MarkdownEditor from "@/components/MarkdownEditor";
import AttachmentUploader from "@/components/attachments/AttachmentUploader";
import AttachmentList from "@/components/attachments/AttachmentList";
import { adminAttachments } from "@/lib/attachments-api";
import { toast } from "@/lib/toast";
import {
  adminApi,
  type Approval,
  type ApprovalKind,
  type CustomerContactRow,
} from "@/lib/admin-api";
import ApprovalStatusBadge from "./ApprovalStatusBadge";
import ApprovalItemsTable from "./ApprovalItemsTable";
import { formatMoney } from "./util";

const KINDS: ApprovalKind[] = ["quotation", "resolution", "general"];

export default function ApprovalSection({
  subjectType,
  subjectId,
  customerId,
  defaultKind = "quotation",
  refreshKey,
  onChanged,
}: {
  subjectType: string;
  subjectId: string;
  customerId: string;
  defaultKind?: ApprovalKind;
  refreshKey?: number;
  onChanged?: () => void;
}) {
  const t = useTranslations("approvals");
  const [list, setList] = useState<Approval[]>([]);
  const [contacts, setContacts] = useState<CustomerContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Builder state.
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ApprovalKind>(defaultKind);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [items, setItems] = useState<{ label: string; amount: string }[]>([]);
  const [creating, setCreating] = useState(false);

  // Per-draft recipient selection.
  const [recipient, setRecipient] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, c] = await Promise.all([
        adminApi.listApprovals(subjectType, subjectId),
        adminApi.listCustomerContacts(customerId).catch(() => ({ contacts: [] as CustomerContactRow[] })),
      ]);
      setList(a.approvals ?? []);
      setContacts((c.contacts ?? []).filter((x) => !x.disabled_at));
    } catch (e) {
      toast.error(tryMsg(e));
    } finally {
      setLoading(false);
    }
  }, [subjectType, subjectId, customerId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  async function createDraft() {
    if (!title.trim() || creating) return;
    setCreating(true);
    try {
      const built = items
        .filter((i) => i.label.trim())
        .map((i) => ({
          item_type: "text" as const,
          label: i.label.trim(),
          amount_cents: Math.round((parseFloat(i.amount) || 0) * 100),
        }));
      await adminApi.createApproval({
        subject_type: subjectType,
        subject_id: subjectId,
        kind,
        title: title.trim(),
        body_md: body,
        items: built.length ? built : undefined,
      });
      toast.success(t("toast.created"));
      setOpen(false);
      setTitle(""); setBody(""); setItems([]); setKind(defaultKind);
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(tryMsg(e));
    } finally {
      setCreating(false);
    }
  }

  async function act(id: string, fn: () => Promise<unknown>, okMsg: string) {
    setBusyId(id);
    try {
      await fn();
      toast.success(okMsg);
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(tryMsg(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-medium text-navy-800">
          <ClipboardCheck className="h-4 w-4 text-accent-700" /> {t("admin.title")}
        </div>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className="btn-ghost text-xs">
            <Plus className="h-3.5 w-3.5" /> {t("admin.new")}
          </button>
        )}
      </div>

      {/* Builder */}
      {open && (
        <div className="mb-4 rounded-lg border border-navy-100 bg-navy-50/40 p-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-navy-800 mb-1">{t("admin.kind")}</label>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as ApprovalKind)}
                className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm"
              >
                {KINDS.map((k) => <option key={k} value={k}>{t(`kind.${k}`)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-navy-800 mb-1">{t("admin.titleLabel")}</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                placeholder={t("admin.titlePlaceholder")}
                className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-navy-800 mb-1">{t("admin.body")}</label>
            <MarkdownEditor value={body} onChange={setBody} rows={4} maxLength={10000} placeholder={t("admin.bodyPlaceholder")} />
          </div>

          {kind === "quotation" ? (
            <p className="text-[11px] text-navy-500">{t("admin.itemsQuotationHint")}</p>
          ) : (
            <div className="space-y-2">
              <label className="block text-xs font-medium text-navy-800">{t("admin.items")}</label>
              {items.map((it, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={it.label}
                    onChange={(e) => setItems((p) => p.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
                    placeholder={t("admin.itemLabel")}
                    className="flex-1 rounded-lg border border-navy-200 px-3 py-1.5 text-sm focus:border-accent-500 focus:outline-none"
                  />
                  <input
                    value={it.amount}
                    onChange={(e) => setItems((p) => p.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))}
                    inputMode="decimal"
                    placeholder={t("admin.itemAmount")}
                    className="w-28 rounded-lg border border-navy-200 px-3 py-1.5 text-sm text-right focus:border-accent-500 focus:outline-none"
                  />
                  <button type="button" onClick={() => setItems((p) => p.filter((_, j) => j !== i))} className="rounded p-1 text-navy-400 hover:bg-navy-100 hover:text-navy-700">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => setItems((p) => [...p, { label: "", amount: "" }])} className="btn-ghost text-xs">
                <Plus className="h-3.5 w-3.5" /> {t("admin.addItem")}
              </button>
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-navy-100 pt-3">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">{t("admin.close")}</button>
            <button type="button" onClick={createDraft} disabled={!title.trim() || creating} className="btn-accent">
              {creating ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("admin.creating")}</> : <><Plus className="h-4 w-4" /> {t("admin.create")}</>}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <p className="text-sm text-navy-500"><Loader2 className="inline h-3.5 w-3.5 animate-spin" /> {t("admin.loading")}</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-navy-500 italic">{t("admin.none")}</p>
      ) : (
        <ul className="space-y-3">
          {list.map((a) => (
            <li key={a.id} className="rounded-lg border border-navy-100 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-navy-400">{t(`kind.${a.kind}`)}</span>
                    <ApprovalStatusBadge status={a.status} label={t(`status.${a.status}`)} />
                  </div>
                  <p className="mt-0.5 font-medium text-navy-900">{a.title}</p>
                  {a.total_cents > 0 && (
                    <p className="text-xs text-navy-600 tabular-nums">{formatMoney(a.total_cents, a.currency)}</p>
                  )}
                </div>
              </div>

              {a.items && a.items.length > 0 && (
                <div className="mt-2">
                  <ApprovalItemsTable
                    items={a.items}
                    currency={a.currency}
                    subtotalCents={a.subtotal_cents}
                    vatCents={a.vat_cents}
                    totalCents={a.total_cents}
                    vatRateBp={a.vat_rate_bp}
                  />
                </div>
              )}

              {/* Decision info */}
              {(a.status === "approved" || a.status === "declined") && (
                <p className="mt-2 text-xs text-navy-600">
                  {t("admin.decidedBy", {
                    decision: t(`decision.${a.status}`),
                    name: a.decided_by_name ?? "—",
                    date: a.decided_at ? new Date(a.decided_at).toLocaleString() : "",
                  })}
                  {a.status === "declined" && a.decline_reason && (
                    <span className="mt-0.5 block text-red-700">{t("admin.declineReason", { reason: a.decline_reason })}</span>
                  )}
                </p>
              )}
              {a.status === "sent" && a.expires_at && (
                <p className="mt-2 text-xs text-amber-700">{t("admin.expires", { date: new Date(a.expires_at).toLocaleDateString() })}</p>
              )}

              {/* Draft actions: attach + send */}
              {a.status === "draft" && (
                <div className="mt-3 space-y-2 border-t border-navy-100 pt-3">
                  <div className="text-[11px] font-medium text-navy-700 flex items-center gap-1"><Paperclip className="h-3 w-3" /> {t("admin.attach")}</div>
                  <AttachmentList ownerType="approval" ownerId={a.id} client={adminAttachments} canDelete />
                  <AttachmentUploader ownerType="approval" ownerId={a.id} client={adminAttachments} compact />
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <select
                      value={recipient[a.id] ?? ""}
                      onChange={(e) => setRecipient((p) => ({ ...p, [a.id]: e.target.value }))}
                      className="rounded-lg border border-navy-200 px-2 py-1.5 text-sm"
                    >
                      <option value="">{t("admin.pickRecipient")}</option>
                      {contacts.map((c) => <option key={c.id} value={c.id}>{c.full_name} ({c.email})</option>)}
                    </select>
                    <button
                      type="button"
                      disabled={!recipient[a.id] || busyId === a.id}
                      onClick={() => act(a.id, () => adminApi.sendApproval(a.id, { contact_id: recipient[a.id] }), t("toast.sent"))}
                      className="btn-accent"
                    >
                      {busyId === a.id ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("admin.sending")}</> : <><Send className="h-4 w-4" /> {t("admin.send")}</>}
                    </button>
                    <button type="button" disabled={busyId === a.id} onClick={() => act(a.id, () => adminApi.deleteApproval(a.id), t("toast.deleted"))} className="btn-ghost text-red-700">
                      <Trash2 className="h-3.5 w-3.5" /> {t("admin.delete")}
                    </button>
                  </div>
                </div>
              )}

              {/* Sent actions: resend / cancel */}
              {a.status === "sent" && (
                <div className="mt-3 flex gap-2 border-t border-navy-100 pt-3">
                  <button type="button" disabled={busyId === a.id} onClick={() => act(a.id, () => adminApi.resendApproval(a.id), t("toast.sent"))} className="btn-ghost text-xs">
                    <RotateCcw className="h-3.5 w-3.5" /> {t("admin.resend")}
                  </button>
                  <button type="button" disabled={busyId === a.id} onClick={() => act(a.id, () => adminApi.cancelApproval(a.id), t("toast.cancelled"))} className="btn-ghost text-xs text-red-700">
                    <X className="h-3.5 w-3.5" /> {t("admin.cancel")}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function tryMsg(e: unknown): string {
  const anyE = e as { body?: string; message?: string };
  if (anyE?.body) {
    try { return (JSON.parse(anyE.body) as { error?: string }).error ?? anyE.body; } catch { return anyE.body; }
  }
  return anyE?.message ?? "error";
}
