"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, CheckCircle2, AlertCircle, ShieldCheck, ShieldAlert, ChevronRight, X, RefreshCw } from "lucide-react";
import { Link } from "@/i18n/routing";
import AdminShell from "@/components/AdminShell";
import { adminApi, type WebhookEvent, type WebhookEventDetail } from "@/lib/admin-api";

const PROCESSED_FILTERS = ["", "true", "false"] as const;

export default function AdminWebhooksPage() {
  const t = useTranslations("admin.webhooks");
  const tc = useTranslations("common");
  const [rows, setRows] = useState<WebhookEvent[] | null>(null);
  const [processed, setProcessed] = useState<string>("");
  const [detail, setDetail] = useState<WebhookEventDetail | null>(null);
  const [replayBusy, setReplayBusy] = useState(false);
  const [replayMsg, setReplayMsg] = useState<string | null>(null);

  async function replay() {
    if (!detail) return;
    setReplayBusy(true); setReplayMsg(null);
    try {
      const r = await adminApi.replayWebhookEvent(detail.id);
      setReplayMsg(t(`replayed.${r.status}`, { defaultValue: r.status }));
      // Re-load the detail + list so processed_at + error are fresh.
      try { setDetail(await adminApi.getWebhookEvent(detail.id)); } catch { /* swallow */ }
      load();
    } catch (e: unknown) {
      const v = e as { body?: string };
      setReplayMsg(v.body || tc("error"));
    } finally {
      setReplayBusy(false);
    }
  }

  function load() {
    setRows(null);
    adminApi.listWebhookEvents(processed ? { processed } : undefined)
      .then(setRows).catch(() => setRows([]));
  }
  useEffect(load, [processed]);

  async function open(id: string) {
    try { setDetail(await adminApi.getWebhookEvent(id)); }
    catch { /* swallow */ }
  }

  return (
    <AdminShell>
      <header className="mb-6">
        <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-navy-600">{t("subtitle")}</p>
      </header>

      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        {PROCESSED_FILTERS.map((s) => (
          <button key={s || "all"} type="button" onClick={() => setProcessed(s)}
            className={`rounded-full border px-3 py-1 ${
              processed === s ? "border-accent-500 bg-accent-50 text-accent-900" : "border-navy-200 text-navy-600 hover:bg-navy-50"
            }`}>
            {s === "" ? t("filter.all") : s === "true" ? t("filter.processed") : t("filter.unprocessed")}
          </button>
        ))}
      </div>

      {rows === null ? (
        <div className="text-navy-500"><Loader2 className="inline h-4 w-4 animate-spin" /> {tc("loading")}</div>
      ) : rows.length === 0 ? (
        <div className="card text-center text-navy-500">{t("empty")}</div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-navy-50 text-left text-xs uppercase tracking-wider text-navy-500">
              <tr>
                <th className="px-4 py-3 font-semibold">{t("col.received")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.provider")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.event")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.signature")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.processed")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.payment")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {rows.map((e) => (
                <tr key={e.id} onClick={() => open(e.id)} className="hover:bg-navy-50 cursor-pointer">
                  <td className="px-4 py-3 text-xs text-navy-600 whitespace-nowrap">
                    {new Date(e.received_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-navy-700 text-xs uppercase">{e.provider}</td>
                  <td className="px-4 py-3 font-mono text-xs">{e.event_type}</td>
                  <td className="px-4 py-3">
                    {e.signature_ok ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                        <ShieldCheck className="h-3 w-3" /> {t("verified")}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-800">
                        <ShieldAlert className="h-3 w-3" /> {t("unverified")}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {e.processed_at ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700">
                        <CheckCircle2 className="h-3 w-3" /> {new Date(e.processed_at).toLocaleString()}
                      </span>
                    ) : e.error ? (
                      <span className="inline-flex items-center gap-1 text-red-700" title={e.error}>
                        <AlertCircle className="h-3 w-3" /> {t("errored")}
                      </span>
                    ) : (
                      <span className="text-navy-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {e.payment_number ? (
                      <Link
                        href={`/admin/invoices/${e.invoice_id ?? ""}`}
                        onClick={(ev) => ev.stopPropagation()}
                        className="text-accent-700 hover:underline"
                      >
                        {e.payment_number} <ChevronRight className="inline h-3 w-3" />
                      </Link>
                    ) : <span className="text-navy-400">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-40 bg-navy-900/40 backdrop-blur-sm grid place-items-center p-4">
          <div className="card max-w-2xl w-full max-h-[90vh] overflow-auto">
            <div className="mb-3 flex items-start justify-between">
              <div>
                <h3 className="font-display text-lg text-navy-900">{detail.event_type}</h3>
                <p className="text-xs text-navy-500 font-mono">{detail.event_id}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={replay}
                  disabled={replayBusy}
                  className="btn-secondary text-xs"
                  title={t("replayHint")}
                >
                  {replayBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  {t("replay")}
                </button>
                <button onClick={() => setDetail(null)} className="text-navy-400 hover:text-navy-700">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            {replayMsg && <p className="mb-2 text-xs text-emerald-700">{replayMsg}</p>}
            <dl className="grid gap-1 text-xs mb-3">
              <Field label={t("col.received")} value={new Date(detail.received_at).toLocaleString()} />
              <Field label={t("col.signature")} value={detail.signature_ok ? t("verified") : t("unverified")} />
              <Field label={t("col.processed")} value={detail.processed_at ? new Date(detail.processed_at).toLocaleString() : t("notProcessed")} />
              {detail.error && <Field label={t("error")} value={detail.error} />}
            </dl>
            <h4 className="text-xs font-semibold uppercase text-navy-500 mb-1">{t("payload")}</h4>
            <pre className="bg-navy-50 rounded-md p-3 text-[10px] font-mono overflow-x-auto max-h-96">
              {(() => { try { return JSON.stringify(JSON.parse(detail.payload), null, 2); } catch { return detail.payload; } })()}
            </pre>
          </div>
        </div>
      )}
    </AdminShell>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-navy-50 py-1">
      <dt className="text-navy-500">{label}</dt>
      <dd className="text-navy-900 text-right break-all">{value}</dd>
    </div>
  );
}
