"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import {
  Loader2, ArrowLeft, FileText, FileType, Printer, Download, UploadCloud,
  Stamp, PenLine, CheckCircle2, XCircle, Clock,
} from "lucide-react";
import AdminShell from "@/components/AdminShell";
import {
  contractApi, openContractFile, type Contract, type ContractFile,
} from "@/lib/contract-api";
import { StatusBadge, formatTHB, formatDate } from "../_shared";

export default function ContractDetailPage() {
  const t = useTranslations("admin.contracts");
  const tc = useTranslations("common");
  const params = useParams();
  const id = String(params?.id ?? "");

  const [c, setC] = useState<Contract | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    return contractApi.get(id).then(setC).catch((e) => setError(String(e)));
  }, [id]);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  async function act(kind: string, fn: () => Promise<unknown>) {
    setBusy(kind);
    setError("");
    try { await fn(); await load(); }
    catch (e) { setError(String(e)); }
    finally { setBusy(""); }
  }

  if (loading) {
    return <AdminShell><div className="flex items-center gap-2 text-navy-500"><Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}</div></AdminShell>;
  }
  if (!c) {
    return <AdminShell><p className="text-navy-500">{t("notFound")}</p></AdminShell>;
  }

  const isDraft = c.status === "draft";
  const files = c.files ?? [];
  const pdf = files.find((f) => f.kind === "generated_pdf");

  return (
    <AdminShell>
      <Link href="/admin/contracts" className="mb-4 inline-flex items-center gap-2 text-sm text-navy-600 hover:text-navy-900">
        <ArrowLeft className="h-4 w-4" /> {t("backToList")}
      </Link>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 data-testid="contract-doc-no" className="font-display text-3xl text-navy-900">{c.doc_no}</h1>
            <StatusBadge status={c.status} />
          </div>
          <p className="mt-1 text-sm text-navy-600">{c.template_name} · {c.party_name}</p>
        </div>
      </header>

      {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          {/* Actions */}
          <section className="card">
            <h2 className="mb-3 font-medium text-navy-900">{t("actions.title")}</h2>
            <div className="flex flex-wrap gap-2">
              <ActionButton
                icon={<Stamp className="h-4 w-4" />} busy={busy === "draft"}
                label={t("actions.generateDraft")}
                onClick={() => act("draft", () => contractApi.generate(c.id, true))}
              />
              {(c.status === "draft") && (
                <ActionButton
                  icon={<PenLine className="h-4 w-4" />} busy={busy === "sign"} primary
                  label={t("actions.generateSigning")}
                  onClick={() => act("sign", () => contractApi.generate(c.id, false))}
                />
              )}
              {c.status !== "active" && c.status !== "terminated" && c.status !== "expired" && (
                <ActionButton
                  icon={<XCircle className="h-4 w-4" />} busy={busy === "term"}
                  label={t("actions.terminate")}
                  onClick={() => act("term", () => contractApi.changeStatus(c.id, { to: "terminated" }))}
                />
              )}
            </div>
          </section>

          {/* Upload signed copy */}
          {(c.status === "sent" || c.status === "signed") && (
            <UploadSigned
              contractId={c.id}
              onUploaded={() => load()}
            />
          )}

          {/* Confirm active */}
          {c.status === "signed" && (
            <ConfirmActive
              contract={c}
              busy={busy === "active"}
              onConfirm={(effective, end) =>
                act("active", () => contractApi.changeStatus(c.id, { to: "active", effective_date: effective, end_date: end }))}
            />
          )}

          {/* Merge data */}
          <MergeDataPanel contract={c} editable={isDraft} onSaved={load} />
        </div>

        <aside className="space-y-6">
          {/* Files */}
          <section className="card">
            <h2 className="mb-3 font-medium text-navy-900">{t("files.title")}</h2>
            {files.length === 0 ? (
              <p className="text-sm text-navy-400">{t("files.none")}</p>
            ) : (
              <ul className="space-y-2">
                {files.map((f) => <FileRow key={f.id} contractId={c.id} file={f} />)}
              </ul>
            )}
            {pdf && (
              <button
                onClick={() => openContractFile(c.id, pdf, "view")}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-navy-800 px-3 py-2 text-sm font-medium text-white hover:bg-navy-900"
              >
                <Printer className="h-4 w-4" /> {t("files.print")}
              </button>
            )}
          </section>

          {/* Meta */}
          <section className="card text-sm">
            <h2 className="mb-3 font-medium text-navy-900">{t("meta.title")}</h2>
            <MetaRow label={t("col.effective")} value={formatDate(c.effective_date)} />
            <MetaRow label={t("col.end")} value={formatDate(c.end_date)} />
            <MetaRow label={t("col.fee")} value={formatTHB(c.fee_total)} />
          </section>

          {/* Timeline */}
          <section className="card">
            <h2 className="mb-3 font-medium text-navy-900">{t("timeline.title")}</h2>
            <ol className="space-y-3">
              {(c.events ?? []).map((e) => (
                <li key={e.id} className="flex gap-3 text-sm">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-navy-300" />
                  <div>
                    <div className="text-navy-800">
                      {e.from_status ? `${e.from_status} → ` : ""}<span className="font-medium">{e.to_status}</span>
                    </div>
                    {e.note && <div className="text-xs text-navy-500">{e.note}</div>}
                    <div className="text-xs text-navy-400">{new Date(e.created_at).toLocaleString()}</div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </AdminShell>
  );
}

function ActionButton({ icon, label, onClick, busy, primary }: {
  icon: React.ReactNode; label: string; onClick: () => void; busy?: boolean; primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50 ${primary ? "bg-accent-500 text-white hover:bg-accent-600" : "border border-navy-200 text-navy-700 hover:bg-navy-50"}`}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : icon} {label}
    </button>
  );
}

function FileRow({ contractId, file }: { contractId: string; file: ContractFile }) {
  const t = useTranslations("admin.contracts");
  const isPdf = file.mime_type === "application/pdf";
  const Icon = file.kind === "signed_scan" ? FileText : isPdf ? FileType : FileText;
  return (
    <li className="flex items-center gap-2 rounded-lg border border-navy-100 px-3 py-2 text-sm">
      <Icon className="h-4 w-4 text-navy-400" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-navy-800">{t(`files.kind.${file.kind}`)}</div>
        <div className="truncate text-xs text-navy-400">{file.filename} · {(file.size_bytes / 1024).toFixed(0)} KB</div>
      </div>
      <button onClick={() => openContractFile(contractId, file, "view")} className="rounded p-1 text-navy-500 hover:bg-navy-50" title={t("files.view")}>
        <Printer className="h-4 w-4" />
      </button>
      <button onClick={() => openContractFile(contractId, file, "download")} className="rounded p-1 text-navy-500 hover:bg-navy-50" title={t("files.download")}>
        <Download className="h-4 w-4" />
      </button>
    </li>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-2 flex justify-between gap-3">
      <span className="text-navy-500">{label}</span>
      <span className="font-medium text-navy-800">{value}</span>
    </div>
  );
}

function UploadSigned({ contractId, onUploaded }: { contractId: string; onUploaded: () => void }) {
  const t = useTranslations("admin.contracts");
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function handle(file: File) {
    setBusy(true); setErr("");
    try { await contractApi.uploadSigned(contractId, file); onUploaded(); }
    catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <section className="card">
      <h2 className="mb-3 font-medium text-navy-900">{t("upload.title")}</h2>
      <label
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) handle(f); }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center text-sm ${drag ? "border-accent-400 bg-accent-50" : "border-navy-200 text-navy-500 hover:bg-navy-50"}`}
      >
        {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <UploadCloud className="h-6 w-6 text-navy-400" />}
        <span>{t("upload.hint")}</span>
        <span className="text-xs text-navy-400">{t("upload.formats")}</span>
        {/* capture allows a phone camera to photograph the signed pages */}
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          capture="environment"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handle(f); }}
        />
      </label>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
    </section>
  );
}

function ConfirmActive({ contract, busy, onConfirm }: {
  contract: Contract; busy: boolean; onConfirm: (effective: string, end: string) => void;
}) {
  const t = useTranslations("admin.contracts");
  const [eff, setEff] = useState(contract.effective_date ?? "");
  const [end, setEnd] = useState(contract.end_date ?? "");
  return (
    <section className="card border-green-200 bg-green-50/40">
      <h2 className="mb-1 flex items-center gap-2 font-medium text-navy-900">
        <CheckCircle2 className="h-4 w-4 text-green-600" /> {t("activate.title")}
      </h2>
      <p className="mb-3 text-sm text-navy-600">{t("activate.hint")}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-navy-600">{t("col.effective")}</span>
          <input type="date" value={eff} onChange={(e) => setEff(e.target.value)} className="rounded-lg border border-navy-200 px-3 py-2 text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-navy-600">{t("col.end")}</span>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="rounded-lg border border-navy-200 px-3 py-2 text-sm" />
        </label>
        <button
          onClick={() => onConfirm(eff, end)}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} {t("activate.confirm")}
        </button>
      </div>
    </section>
  );
}

function MergeDataPanel({ contract, editable, onSaved }: {
  contract: Contract; editable: boolean; onSaved: () => void;
}) {
  const t = useTranslations("admin.contracts");
  const [raw, setRaw] = useState(JSON.stringify(contract.merge_data ?? {}, null, 2));
  const [eff, setEff] = useState(contract.effective_date ?? "");
  const [end, setEnd] = useState(contract.end_date ?? "");
  const [fee, setFee] = useState(contract.fee_total != null ? String(contract.fee_total) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    setBusy(true); setErr("");
    try {
      const merge = JSON.parse(raw);
      await contractApi.update(contract.id, {
        merge_data: merge,
        effective_date: eff || undefined,
        end_date: end || undefined,
        fee_total: fee ? Number(fee) : undefined,
      });
      onSaved();
    } catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <section className="card">
      <h2 className="mb-3 font-medium text-navy-900">{t("mergeData.title")}</h2>
      {!editable && <p className="mb-3 text-xs text-amber-600">{t("mergeData.lockedHint")}</p>}
      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block text-navy-600">{t("col.effective")}</span>
          <input type="date" disabled={!editable} value={eff} onChange={(e) => setEff(e.target.value)} className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm disabled:bg-navy-50" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-navy-600">{t("col.end")}</span>
          <input type="date" disabled={!editable} value={end} onChange={(e) => setEnd(e.target.value)} className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm disabled:bg-navy-50" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-navy-600">{t("col.fee")}</span>
          <input type="number" disabled={!editable} value={fee} onChange={(e) => setFee(e.target.value)} className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm disabled:bg-navy-50" />
        </label>
      </div>
      <textarea
        disabled={!editable}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        rows={12}
        className="w-full rounded-lg border border-navy-200 px-3 py-2 font-mono text-xs disabled:bg-navy-50"
      />
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      {editable && (
        <button onClick={save} disabled={busy}
          className="mt-3 inline-flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {t("mergeData.save")}
        </button>
      )}
    </section>
  );
}
