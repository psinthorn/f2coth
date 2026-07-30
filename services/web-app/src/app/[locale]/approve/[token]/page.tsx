"use client";

// Public magic-link approval page. Reached from the email link
// (/{locale}/approve/{token}); NO login required — the token in the URL is the
// credential, validated server-side. Customers view the bundle + attachments
// and approve or decline (with a reason). Mirrors the DSR confirm page in being
// a standalone, unauthenticated locale-aware page.

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import {
  Loader2, CheckCircle2, XCircle, AlertTriangle, FileText, ShieldCheck,
} from "lucide-react";
import CMSPageBody from "@/components/CMSPageBody";
import ApprovalItemsTable from "@/components/approvals/ApprovalItemsTable";
import type { Approval } from "@/lib/admin-api";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/api";

type FileMeta = { id: string; kind: string; filename: string; mime_type: string };
type ViewState = "loading" | "open" | "invalid" | "expired" | "decided";

export default function PublicApprovalPage() {
  const t = useTranslations("approvals");
  const params = useParams<{ token: string }>();
  const token = params?.token;

  const [state, setState] = useState<ViewState>("loading");
  const [approval, setApproval] = useState<Approval | null>(null);
  const [files, setFiles] = useState<FileMeta[]>([]);
  const [decision, setDecision] = useState<"approved" | "declined" | null>(null);
  const [reason, setReason] = useState("");
  const [declining, setDeclining] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [finalStatus, setFinalStatus] = useState<string>("");

  const linkBase = `${API_BASE}/customer/approvals/link/${token}`;

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(linkBase);
      if (!res.ok) { setState("invalid"); return; }
      const data = await res.json();
      const a: Approval = data.approval;
      setApproval(a);
      setFiles(data.files ?? []);
      if (a.status === "expired") setState("expired");
      else if (a.status === "sent") setState("open");
      else { setFinalStatus(a.status); setState("decided"); }
    } catch {
      setState("invalid");
    }
  }, [token, linkBase]);

  useEffect(() => { load(); }, [load]);

  async function submit(kind: "approved" | "declined") {
    if (submitting) return;
    if (kind === "declined" && !reason.trim()) { setDeclining(true); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`${linkBase}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: kind, reason: reason.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 410) { setState("expired"); return; }
      if (!res.ok) { setState("invalid"); return; }
      setFinalStatus(data.status ?? kind);
      setState("decided");
    } catch {
      setState("invalid");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-navy-50/50 px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center gap-2 text-navy-700">
          <ShieldCheck className="h-5 w-5 text-accent-700" />
          <span className="font-display text-lg text-navy-900">F2 Co., Ltd.</span>
        </div>

        {state === "loading" && (
          <div className="card flex items-center gap-2 text-navy-500">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("public.loading")}
          </div>
        )}

        {state === "invalid" && (
          <StatusCard tone="stop" icon={<AlertTriangle className="h-6 w-6" />} title={t("public.invalidTitle")} body={t("public.invalidBody")} />
        )}
        {state === "expired" && (
          <StatusCard tone="stop" icon={<AlertTriangle className="h-6 w-6" />} title={t("public.expiredTitle")} body={t("public.expiredBody")} />
        )}

        {state === "decided" && (
          finalStatus === "approved" ? (
            <StatusCard tone="ok" icon={<CheckCircle2 className="h-6 w-6" />} title={t("public.approvedTitle")} body={t("public.approvedBody")} />
          ) : finalStatus === "declined" ? (
            <StatusCard tone="stop" icon={<XCircle className="h-6 w-6" />} title={t("public.declinedTitle")} body={t("public.declinedBody")} />
          ) : (
            <StatusCard tone="neutral" icon={<AlertTriangle className="h-6 w-6" />} title={t("public.alreadyTitle")} body={t("public.invalidBody")} />
          )
        )}

        {state === "open" && approval && (
          <div className="space-y-4">
            <div className="card">
              <div className="text-[11px] uppercase tracking-wider text-accent-700">{t(`kind.${approval.kind}`)}</div>
              <h1 className="mt-1 font-display text-2xl text-navy-900">{approval.title}</h1>
              <p className="mt-1 text-sm text-navy-500">{t("public.from", { org: approval.customer_name ?? "" })}</p>
              {approval.body_md && (
                <div className="mt-3 text-sm text-navy-800"><CMSPageBody markdown={approval.body_md} /></div>
              )}
            </div>

            {approval.items && approval.items.length > 0 && (
              <div className="card">
                <ApprovalItemsTable
                  items={approval.items}
                  currency={approval.currency}
                  subtotalCents={approval.subtotal_cents}
                  vatCents={approval.vat_cents}
                  totalCents={approval.total_cents}
                  vatRateBp={approval.vat_rate_bp}
                />
              </div>
            )}

            {files.length > 0 && (
              <div className="card">
                <div className="mb-2 text-sm font-medium text-navy-800">{t("public.attachments")}</div>
                <ul className="space-y-1.5">
                  {files.map((f) => (
                    <li key={f.id}>
                      <a
                        href={`${linkBase}/files/${f.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-sm text-accent-700 hover:text-accent-900"
                      >
                        <FileText className="h-4 w-4" /> {f.filename}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="card">
              {approval.expires_at && (
                <p className="mb-3 text-xs text-navy-500">
                  {t("public.expiresOn", { date: new Date(approval.expires_at).toLocaleDateString() })}
                </p>
              )}
              {!declining ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => submit("approved")}
                    className="btn-accent"
                  >
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} {t("public.approve")}
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => setDeclining(true)}
                    className="btn-ghost text-red-700"
                  >
                    <XCircle className="h-4 w-4" /> {t("public.decline")}
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-navy-800">{t("public.declineReason")}</label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    maxLength={2000}
                    placeholder={t("public.declineReasonPlaceholder")}
                    className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={submitting || !reason.trim()}
                      onClick={() => submit("declined")}
                      className="btn-accent"
                    >
                      {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} {t("public.submit")}
                    </button>
                    <button type="button" onClick={() => { setDeclining(false); setReason(""); }} className="btn-ghost">
                      {t("admin.close")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function StatusCard({ tone, icon, title, body }: {
  tone: "ok" | "stop" | "neutral"; icon: React.ReactNode; title: string; body: string;
}) {
  const toneCls =
    tone === "ok" ? "text-emerald-700" : tone === "stop" ? "text-red-700" : "text-navy-600";
  return (
    <div className="card text-center">
      <div className={`mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-navy-50 ${toneCls}`}>
        {icon}
      </div>
      <h1 className="font-display text-xl text-navy-900">{title}</h1>
      <p className="mt-2 text-sm text-navy-600">{body}</p>
    </div>
  );
}
