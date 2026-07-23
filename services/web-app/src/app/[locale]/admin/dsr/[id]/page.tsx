"use client";

import { use, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { Loader2, ArrowLeft } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { toast } from "@/lib/toast";
import { adminApi, type DSR, type DSRStatus } from "@/lib/admin-api";

const NEXT_STATUSES: Record<DSRStatus, DSRStatus[]> = {
  pending:     ["in_progress", "rejected", "withdrawn"],
  in_progress: ["completed", "rejected", "withdrawn"],
  completed:   [],
  rejected:    [],
  withdrawn:   [],
};

export default function AdminDSRDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const t = useTranslations("admin.dsr");
  const tc = useTranslations("common");
  const router = useRouter();

  const [dsr, setDsr] = useState<DSR | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Editable fields
  const [status, setStatus] = useState<DSRStatus>("pending");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    adminApi.getDSR(id)
      .then((d) => {
        setDsr(d);
        setStatus(d.status);
        setNotes(d.response_notes ?? "");
      })
      .catch(() => setError(tc("errorLoad")))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleSave() {
    if (!dsr) return;
    setSaving(true);
    setError("");
    try {
      await adminApi.updateDSR(id, {
        status: status !== dsr.status ? status : undefined,
        response_notes: notes !== (dsr.response_notes ?? "") ? notes : undefined,
      });
      toast.success(tc("toast.saved"));
      router.push("/admin/dsr" as any);
    } catch {
      setError(t("saveError"));
      toast.error(t("saveError"));
      setSaving(false);
    }
  }

  const due = dsr ? new Date(dsr.due_date) : null;
  const isOverdue =
    dsr &&
    (dsr.status === "pending" || dsr.status === "in_progress") &&
    due !== null &&
    due < new Date();

  return (
    <AdminShell>
      <div className="mb-4">
        <button
          onClick={() => router.push("/admin/dsr" as any)}
          className="flex items-center gap-1 text-sm text-navy-500 hover:text-accent-700"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("backToQueue")}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-navy-500">
          <Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}
        </div>
      ) : !dsr ? (
        <div className="card text-center text-navy-500">{t("notFound")}</div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left: requester info */}
          <div className="lg:col-span-1 space-y-4">
            <div className="card">
              <h2 className="font-display text-lg text-navy-900 mb-3">{t("section.requester")}</h2>
              <dl className="space-y-2 text-sm">
                <Row label={t("field.name")} value={dsr.requester_name} />
                <Row label={t("field.email")} value={<a href={`mailto:${dsr.requester_email}`} className="text-accent-700 underline">{dsr.requester_email}</a>} />
                <Row label={t("field.type")} value={t(`type.${dsr.request_type}`)} />
                <Row label={t("field.locale")} value={dsr.locale.toUpperCase()} />
                <Row label={t("field.submitted")} value={new Date(dsr.created_at).toLocaleString()} />
                <Row
                  label={t("field.due")}
                  value={
                    <span className={isOverdue ? "text-red-600 font-semibold" : ""}>
                      {due?.toLocaleDateString()}{isOverdue ? " ⚠ overdue" : ""}
                    </span>
                  }
                />
                {dsr.fulfilled_at && (
                  <Row label={t("field.fulfilledAt")} value={new Date(dsr.fulfilled_at).toLocaleString()} />
                )}
              </dl>
            </div>

            {dsr.description && (
              <div className="card">
                <h2 className="font-display text-lg text-navy-900 mb-2">{t("section.description")}</h2>
                <p className="text-sm text-navy-700 whitespace-pre-wrap">{dsr.description}</p>
              </div>
            )}
          </div>

          {/* Right: actions */}
          <div className="lg:col-span-2 space-y-4">
            <div className="card">
              <h2 className="font-display text-lg text-navy-900 mb-4">{t("section.actions")}</h2>

              {/* Status */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-navy-700 mb-1">
                  {t("field.status")}
                </label>
                {NEXT_STATUSES[dsr.status].length === 0 ? (
                  <p className="text-sm text-navy-500">{t(`status.${dsr.status}`)} — {t("terminalStatus")}</p>
                ) : (
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as DSRStatus)}
                    className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
                  >
                    <option value={dsr.status}>{t(`status.${dsr.status}`)} ({tc("current")})</option>
                    {NEXT_STATUSES[dsr.status].map((s) => (
                      <option key={s} value={s}>{t(`status.${s}`)}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Response notes */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-navy-700 mb-1">
                  {t("field.responseNotes")}
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={6}
                  maxLength={5000}
                  placeholder={t("notesPlaceholder")}
                  className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
                />
                <p className="mt-1 text-xs text-navy-400">{t("notesHint")}</p>
              </div>

              {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

              {NEXT_STATUSES[dsr.status].length > 0 && (
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="btn-accent disabled:opacity-60"
                >
                  {saving ? <><Loader2 className="inline h-4 w-4 animate-spin mr-1" />{tc("saving")}</> : t("saveBtn")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 text-navy-500">{label}</dt>
      <dd className="text-navy-800">{value}</dd>
    </div>
  );
}
