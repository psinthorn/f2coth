"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Plus, Receipt, Send, Ban, Download } from "lucide-react";
import { Link } from "@/i18n/routing";
import AdminShell from "@/components/AdminShell";
import { adminApi, type AdminInvoice } from "@/lib/admin-api";
import { formatMoney, invoiceStatusTone } from "@/lib/payment-types";

const STATUSES = ["", "draft", "issued", "partially_paid", "paid", "overdue", "void", "refunded"] as const;

export default function AdminInvoicesPage() {
  const t = useTranslations("admin.invoices");
  const tc = useTranslations("common");
  const [invoices, setInvoices] = useState<AdminInvoice[] | null>(null);
  const [status, setStatus] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function reload() {
    setInvoices(null);
    setSelected(new Set());
    adminApi
      .listInvoices(status ? { status } : undefined)
      .then(setInvoices)
      .catch(() => setInvoices([]));
  }
  useEffect(reload, [status]);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (!invoices) return;
    const eligible = invoices.filter((i) => i.status === "draft" || ["issued", "partially_paid", "overdue"].includes(i.status));
    if (selected.size === eligible.length) setSelected(new Set());
    else setSelected(new Set(eligible.map((i) => i.id)));
  }
  async function bulkIssue() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkBusy(true); setMsg(null);
    try {
      const r = await adminApi.bulkIssueInvoices(ids);
      setMsg(t("bulkResult", { succeeded: r.succeeded, skipped: r.skipped }));
      reload();
    } finally { setBulkBusy(false); }
  }
  async function bulkVoid() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const reason = window.prompt(t("voidReasonPrompt")) ?? "";
    if (!reason) return;
    setBulkBusy(true); setMsg(null);
    try {
      const r = await adminApi.bulkVoidInvoices(ids, reason);
      setMsg(t("bulkResult", { succeeded: r.succeeded, skipped: r.skipped }));
      reload();
    } finally { setBulkBusy(false); }
  }
  function downloadCSV(kind: "invoices" | "payments") {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "/api";
    const t = sessionStorage.getItem("f2_access_token");
    // Token-on-query is unsafe; instead open in same tab so the
    // Authorization header is unnecessary — admin routes are already
    // session-cookie protected via Authorization for fetch. But since
    // browsers can't attach headers on plain link clicks, fetch the
    // blob and download.
    fetch(`${apiBase}/payment/admin/exports/${kind}.csv`, {
      headers: t ? { Authorization: `Bearer ${t}` } : undefined,
    })
      .then((res) => res.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `${kind}.csv`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      });
  }

  return (
    <AdminShell>
      <header className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
          <p className="mt-1 text-sm text-navy-600">{t("subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => downloadCSV("invoices")} className="btn-secondary">
            <Download className="h-4 w-4" /> {t("exportInvoices")}
          </button>
          <button type="button" onClick={() => downloadCSV("payments")} className="btn-secondary">
            <Download className="h-4 w-4" /> {t("exportPayments")}
          </button>
          <Link href={"/admin/invoices/new" as never} className="btn-accent">
            <Plus className="h-4 w-4" /> {t("create")}
          </Link>
        </div>
      </header>

      {selected.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border-2 border-accent-200 bg-accent-50/40 px-4 py-2">
          <span className="text-sm font-medium text-navy-900">
            {t("selectedCount", { count: selected.size })}
          </span>
          <button type="button" onClick={bulkIssue} disabled={bulkBusy} className="btn-accent text-xs py-1">
            {bulkBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            {t("bulkIssue")}
          </button>
          <button type="button" onClick={bulkVoid} disabled={bulkBusy} className="btn-secondary text-xs py-1">
            <Ban className="h-3 w-3" /> {t("bulkVoid")}
          </button>
          <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-navy-500 hover:text-navy-900">
            {tc("cancel")}
          </button>
        </div>
      )}
      {msg && <p className="mb-3 text-sm text-emerald-700">{msg}</p>}

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        {STATUSES.map((s) => (
          <button
            key={s || "all"}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded-full border px-3 py-1 ${
              status === s ? "border-accent-500 bg-accent-50 text-accent-900" : "border-navy-200 text-navy-600 hover:bg-navy-50"
            }`}
          >
            {s ? t(`status.${s}`) : t("all")}
          </button>
        ))}
      </div>

      {invoices === null ? (
        <div className="flex items-center gap-2 text-navy-500"><Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}</div>
      ) : invoices.length === 0 ? (
        <div className="card text-center text-navy-500">{t("empty")}</div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-navy-50 text-left text-xs uppercase tracking-wider text-navy-500">
              <tr>
                <th className="px-2 py-3">
                  <input type="checkbox" onChange={toggleAll}
                    checked={
                      invoices.length > 0 &&
                      invoices.filter((i) => i.status === "draft" || ["issued","partially_paid","overdue"].includes(i.status)).every((i) => selected.has(i.id))
                    } />
                </th>
                <th className="px-4 py-3 font-semibold">{t("col.number")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.customer")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.issued")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.due")}</th>
                <th className="px-4 py-3 font-semibold text-right">{t("col.total")}</th>
                <th className="px-4 py-3 font-semibold text-right">{t("col.paid")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {invoices.map((inv) => {
                const selectable = inv.status === "draft" || ["issued","partially_paid","overdue"].includes(inv.status);
                return (
                <tr key={inv.id} className="hover:bg-navy-50">
                  <td className="px-2 py-3">
                    {selectable && (
                      <input type="checkbox" checked={selected.has(inv.id)} onChange={() => toggle(inv.id)} />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/invoices/${inv.id}`}
                      className="flex items-center gap-2 font-medium text-navy-900 hover:text-accent-700"
                    >
                      <Receipt className="h-3.5 w-3.5 text-navy-400" />
                      {inv.invoice_number}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-navy-700">{inv.customer_name ?? "—"}</td>
                  <td className="px-4 py-3 text-navy-600 text-xs">{inv.issue_date ?? "—"}</td>
                  <td className="px-4 py-3 text-navy-600 text-xs">{inv.due_date ?? "—"}</td>
                  <td className="px-4 py-3 text-right">{formatMoney(inv.total_cents, inv.currency)}</td>
                  <td className="px-4 py-3 text-right text-emerald-700">
                    {formatMoney(inv.amount_paid_cents, inv.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${invoiceStatusTone(inv.status)}`}>
                      {t(`status.${inv.status}`)}
                    </span>
                  </td>
                </tr>
              );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}
