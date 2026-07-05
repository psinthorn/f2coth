"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Loader2, Upload, CheckCircle2, AlertCircle, FileText, Check, X, Zap,
} from "lucide-react";
import { Link } from "@/i18n/routing";
import AdminShell from "@/components/AdminShell";
import {
  adminApi,
  type BankImport,
  type BankImportFull,
} from "@/lib/admin-api";
import { formatMoney } from "@/lib/payment-types";

export default function AdminBankImportsPage() {
  const t = useTranslations("admin.bankImports");
  const tc = useTranslations("common");
  const [list, setList] = useState<BankImport[] | null>(null);
  const [active, setActive] = useState<BankImportFull | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  function reload() {
    adminApi.listBankImports().then(setList).catch(() => setList([]));
  }
  useEffect(reload, []);

  async function upload(file: File) {
    setMsg(null);
    setBusy(true);
    try {
      const r = await adminApi.uploadBankImport(file, sourceName || file.name);
      setActive(r);
      setSourceName("");
      reload();
      setMsg({
        kind: "ok",
        text: t("uploaded", { parsed: r.parsed_rows, matched: r.matched_rows }),
      });
    } catch (e: unknown) {
      const v = e as { body?: string };
      setMsg({ kind: "err", text: v.body || tc("error") });
    } finally {
      setBusy(false);
    }
  }

  async function applyImport() {
    if (!active) return;
    if (!window.confirm(t("applyConfirm", { count: active.matched_rows }))) return;
    setBusy(true); setMsg(null);
    try {
      const r = await adminApi.applyBankImport(active.id);
      setActive(r.import);
      reload();
      setMsg({ kind: "ok", text: t("applied", { count: r.applied }) });
    } catch (e: unknown) {
      const v = e as { body?: string };
      setMsg({ kind: "err", text: v.body || tc("error") });
    } finally {
      setBusy(false);
    }
  }

  async function openImport(id: string) {
    try {
      const r = await adminApi.getBankImport(id);
      setActive(r);
    } catch { /* swallow */ }
  }

  return (
    <AdminShell>
      <header className="mb-6">
        <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-navy-600">{t("subtitle")}</p>
      </header>

      {/* Upload card */}
      <section className="card mb-6">
        <h2 className="font-display text-lg text-navy-900 mb-2">{t("uploadTitle")}</h2>
        <p className="text-xs text-navy-500 mb-3">{t("uploadHint")}</p>
        <p className="text-[11px] text-navy-500 mb-3 font-mono bg-navy-50 rounded px-2 py-1">
          transferred_at, amount_thb, bank_ref, description
        </p>
        <div className="grid gap-2 sm:grid-cols-3 sm:items-end">
          <label className="grid gap-1 text-xs sm:col-span-2">
            {t("sourceName")}
            <input
              type="text"
              value={sourceName}
              onChange={(e) => setSourceName(e.target.value)}
              placeholder={t("sourceNamePlaceholder")}
              className="rounded-md border border-navy-200 px-3 py-2 text-sm"
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
            className="btn-accent"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {t("upload")}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
        </div>
        {msg && (
          <p className={`mt-3 text-sm ${msg.kind === "ok" ? "text-emerald-700" : "text-red-700"}`}>
            {msg.kind === "ok" ? <CheckCircle2 className="inline h-4 w-4 mr-1" /> : <AlertCircle className="inline h-4 w-4 mr-1" />}
            {msg.text}
          </p>
        )}
      </section>

      {/* Active import preview */}
      {active && (
        <section className="card mb-6">
          <header className="mb-3 flex items-start justify-between flex-wrap gap-3">
            <div>
              <h2 className="font-display text-lg text-navy-900">
                <FileText className="inline h-4 w-4 mr-1 text-navy-400" />
                {active.source_name ?? active.raw_filename}
              </h2>
              <p className="text-xs text-navy-500">
                {t("parsedSummary", {
                  parsed: active.parsed_rows,
                  matched: active.matched_rows,
                  applied: active.applied_rows,
                })}
              </p>
            </div>
            {active.matched_rows > active.applied_rows && active.status !== "applied" && (
              <button type="button" className="btn-accent" disabled={busy} onClick={applyImport}>
                <Zap className="h-4 w-4" /> {t("apply", { count: active.matched_rows - active.applied_rows })}
              </button>
            )}
          </header>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-navy-50 text-left text-xs uppercase tracking-wider text-navy-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">#</th>
                  <th className="px-3 py-2 font-semibold">{t("col.date")}</th>
                  <th className="px-3 py-2 font-semibold text-right">{t("col.amount")}</th>
                  <th className="px-3 py-2 font-semibold">{t("col.ref")}</th>
                  <th className="px-3 py-2 font-semibold">{t("col.match")}</th>
                  <th className="px-3 py-2 font-semibold">{t("col.status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {active.rows.map((row) => (
                  <tr key={row.id} className="align-top">
                    <td className="px-3 py-2 text-navy-500 text-xs">{row.line_number}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      {new Date(row.transferred_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatMoney(row.amount_cents)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-navy-600">
                      {row.bank_ref ?? "—"}
                      {row.description && (
                        <p className="text-[10px] text-navy-400 mt-0.5 max-w-xs truncate" title={row.description}>
                          {row.description}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {row.matched_payment_id ? (
                        <>
                          <Link href={{ pathname: "/admin/invoices/[id]", params: { id: row.invoice_id ?? "" } } as never}
                            className="text-accent-700 hover:underline">
                            {row.invoice_number ?? row.payment_number}
                          </Link>
                          <p className="text-[10px] text-navy-500">{row.customer_name}</p>
                        </>
                      ) : (
                        <span className="text-navy-400">{t("noMatch")}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <MatchPill status={row.match_status} t={t} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Recent imports list */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-navy-500">
          {t("recent")}
        </h2>
        {list === null ? (
          <div className="text-navy-500"><Loader2 className="inline h-4 w-4 animate-spin" /> {tc("loading")}</div>
        ) : list.length === 0 ? (
          <div className="card text-center text-navy-500 text-sm">{t("empty")}</div>
        ) : (
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-navy-50 text-left text-xs uppercase tracking-wider text-navy-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">{t("col.source")}</th>
                  <th className="px-4 py-3 font-semibold">{t("col.parsed")}</th>
                  <th className="px-4 py-3 font-semibold">{t("col.matched")}</th>
                  <th className="px-4 py-3 font-semibold">{t("col.applied")}</th>
                  <th className="px-4 py-3 font-semibold">{t("col.status")}</th>
                  <th className="px-4 py-3 font-semibold">{t("col.uploaded")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {list.map((row) => (
                  <tr key={row.id} className="hover:bg-navy-50 cursor-pointer"
                    onClick={() => openImport(row.id)}>
                    <td className="px-4 py-3 font-medium text-navy-900">
                      {row.source_name ?? row.raw_filename}
                    </td>
                    <td className="px-4 py-3">{row.parsed_rows}</td>
                    <td className="px-4 py-3">{row.matched_rows}</td>
                    <td className="px-4 py-3">{row.applied_rows}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${
                        row.status === "applied" ? "bg-emerald-50 text-emerald-800"
                        : row.status === "discarded" ? "bg-navy-100 text-navy-700"
                        : "bg-amber-50 text-amber-800"
                      }`}>
                        {t(`status.${row.status}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-navy-500">
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AdminShell>
  );
}

function MatchPill({ status, t }: { status: string; t: ReturnType<typeof useTranslations> }) {
  const cls =
    status === "applied" ? "bg-emerald-50 text-emerald-800"
    : status === "proposed" ? "bg-blue-50 text-blue-800"
    : status === "skipped" ? "bg-navy-100 text-navy-700"
    : "bg-amber-50 text-amber-800";
  const Icon = status === "applied" ? Check : status === "proposed" ? Zap : X;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${cls}`}>
      <Icon className="h-3 w-3" /> {t(`matchStatus.${status}`)}
    </span>
  );
}
