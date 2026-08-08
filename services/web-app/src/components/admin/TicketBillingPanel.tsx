"use client";

// Ticket billing panel (migration 073): attach priced line items to a ticket —
// each covered (under SLA → ฿0) or billable — then generate a draft invoice.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Loader2, Plus, Trash2, ShieldCheck, Receipt, FileText, AlertTriangle } from "lucide-react";
import { useBusyAction } from "@/lib/toast";
import { formatMoney } from "@/lib/payment-types";
import {
  adminApi,
  type TicketBilling,
  type RateCardItem,
} from "@/lib/admin-api";

export default function TicketBillingPanel({
  ticketId,
  refreshKey,
  onApprovalRequested,
}: {
  ticketId: string;
  refreshKey?: number;
  onApprovalRequested?: () => void;
}) {
  const t = useTranslations("admin.tickets.billing");
  const { busy, run } = useBusyAction();
  const [billing, setBilling] = useState<TicketBilling | null>(null);
  const [rateCard, setRateCard] = useState<RateCardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const initedCovered = useRef(false);

  // Add-line form. price is in whole currency units (baht); stored ×100.
  const empty = { rate_card_item_id: "", description_en: "", unit: "item", quantity: 1, price: 0, covered: false };
  const [form, setForm] = useState(empty);

  const load = useCallback(async () => {
    setErr("");
    try {
      const [b, rc] = await Promise.all([
        adminApi.getTicketBilling(ticketId),
        adminApi.listRateCard(true).catch(() => ({ items: [] as RateCardItem[] })),
      ]);
      setBilling(b);
      setRateCard(rc.items ?? []);
      // Suggest "covered" when an SLA covers this ticket — but only seed it ONCE
      // so a reload never overrides the staff member's manual choice.
      if (!initedCovered.current) {
        initedCovered.current = true;
        setForm((f) => ({ ...f, covered: !!b.covered_by_title }));
      }
    } catch {
      setErr(t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [ticketId, t]);

  useEffect(() => { load(); }, [load, refreshKey]);

  // One-click: create a quotation approval prefilled from this ticket's billable
  // lines (backend snapshots them), then staff send it from the Approvals panel.
  async function requestApproval() {
    const ok = await run(
      () => adminApi.createApproval({
        subject_type: "ticket",
        subject_id: ticketId,
        kind: "quotation",
        title: t("approvalTitle"),
      }),
      { success: t("approvalRequested") },
    );
    if (ok) { onApprovalRequested?.(); await load(); }
  }

  function pickRateCard(id: string) {
    const rc = rateCard.find((r) => r.id === id);
    // Switching back to free text clears the snapshotted rate so a leftover
    // price can't be submitted on a custom line.
    if (!rc) { setForm({ ...form, rate_card_item_id: "", description_en: "", unit: "item", price: 0 }); return; }
    setForm({
      ...form,
      rate_card_item_id: id,
      description_en: rc.name_en,
      unit: rc.unit,
      price: rc.default_unit_price_cents / 100,
    });
  }

  async function addLine() {
    const ok = await run(
      () => adminApi.addTicketLine(ticketId, {
        rate_card_item_id: form.rate_card_item_id || undefined,
        description_en: form.description_en.trim(),
        unit: form.unit,
        quantity: Math.max(1, Math.floor(Number(form.quantity) || 1)),
        unit_price_cents: Math.round((Number(form.price) || 0) * 100),
        covered: form.covered,
      }),
      { success: t("lineAdded") },
    );
    if (ok) { setForm({ ...empty, covered: !!billing?.covered_by_title }); setShowAdd(false); await load(); }
  }

  async function toggleCovered(lineId: string, covered: boolean) {
    const ok = await run(() => adminApi.updateTicketLine(ticketId, lineId, { covered }), { success: t("updated") });
    if (ok) await load();
  }

  async function removeLine(lineId: string) {
    const ok = await run(() => adminApi.deleteTicketLine(ticketId, lineId), { success: t("lineRemoved") });
    if (ok) await load();
  }

  async function generateInvoice() {
    const ok = await run(() => adminApi.generateTicketInvoice(ticketId), { success: t("invoiceCreated") });
    if (ok) await load();
  }

  if (loading) {
    return <div className="card grid place-items-center py-6 text-navy-400"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }
  if (err || !billing) {
    return (
      <div className="card flex items-center gap-2 text-sm text-red-700">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>{err || t("loadError")}</span>
        <button onClick={() => load()} className="ml-auto rounded border border-navy-200 px-2 py-0.5 text-xs text-navy-700 hover:bg-navy-50">
          {t("retry")}
        </button>
      </div>
    );
  }

  const cur = billing.currency;

  return (
    <section className="card">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-semibold text-navy-900">
          <Receipt className="h-4 w-4 text-accent-700" /> {t("title")}
        </h2>
        {!billing.invoice_id && (
          <button onClick={() => setShowAdd((v) => !v)} className="btn-accent text-xs">
            <Plus className="h-3.5 w-3.5" /> {t("addLine")}
          </button>
        )}
      </div>

      {billing.covered_by_title && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          <ShieldCheck className="h-4 w-4 shrink-0" />
          <span>{t("coveredBy", { title: billing.covered_by_title })}</span>
        </div>
      )}

      {showAdd && !billing.invoice_id && (
        <div className="mt-4 rounded-lg border border-navy-100 bg-navy-50 p-4">
          <div className="grid gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium text-navy-800">{t("fromRateCard")}</span>
              <select
                value={form.rate_card_item_id}
                onChange={(e) => pickRateCard(e.target.value)}
                className="rounded-lg border border-navy-200 px-3 py-2 text-sm"
              >
                <option value="">{t("freeText")}</option>
                {rateCard.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name_en} — {formatMoney(r.default_unit_price_cents, r.currency)}/{r.unit}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium text-navy-800">{t("description")}</span>
              <input value={form.description_en} onChange={(e) => setForm({ ...form, description_en: e.target.value })}
                className="rounded-lg border border-navy-200 px-3 py-2 text-sm" />
            </label>
            <div className="grid grid-cols-3 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium text-navy-800">{t("qty")}</span>
                <input type="number" min={1} value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) || 1 })}
                  className="rounded-lg border border-navy-200 px-3 py-2 text-sm" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium text-navy-800">{t("unit")}</span>
                <input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  className="rounded-lg border border-navy-200 px-3 py-2 text-sm" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium text-navy-800">{t("rate", { cur })}</span>
                <input type="number" min={0} step="0.01" value={form.price}
                  onChange={(e) => setForm({ ...form, price: Number(e.target.value) || 0 })}
                  className="rounded-lg border border-navy-200 px-3 py-2 text-sm" />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm text-navy-700">
              <input type="checkbox" checked={form.covered} onChange={(e) => setForm({ ...form, covered: e.target.checked })} />
              {t("coveredLabel")}
            </label>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={() => setShowAdd(false)} className="btn-ghost text-xs">{t("cancel")}</button>
            <button onClick={addLine} disabled={busy || !form.description_en.trim()} className="btn-accent text-xs disabled:opacity-40">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("add")}
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 divide-y divide-navy-100">
        {billing.lines.length === 0 ? (
          <p className="py-2 text-sm text-navy-500">{t("noLines")}</p>
        ) : billing.lines.map((l) => (
          <div key={l.id} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-navy-900">{l.description_en}</p>
              <p className="text-xs text-navy-500">
                {l.quantity} × {formatMoney(l.unit_price_cents, l.currency)}/{l.unit}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {l.covered ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                  <ShieldCheck className="h-3 w-3" /> {t("badgeCovered")}
                </span>
              ) : (
                <span className="text-sm font-medium text-navy-900">{formatMoney(l.amount_cents, l.currency)}</span>
              )}
              {!billing.invoice_id && (
                <>
                  <button onClick={() => toggleCovered(l.id, !l.covered)} disabled={busy}
                    className="rounded border border-navy-200 px-2 py-0.5 text-[11px] text-navy-600 hover:bg-navy-50 disabled:opacity-40">
                    {l.covered ? t("markBillable") : t("markCovered")}
                  </button>
                  <button onClick={() => removeLine(l.id)} disabled={busy}
                    className="text-navy-400 hover:text-red-600 disabled:opacity-40" aria-label={t("remove")}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {billing.lines.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-navy-100 pt-3 text-sm">
          <Row label={t("subtotal")} value={formatMoney(billing.subtotal_cents, cur)} />
          <Row label={t("vat", { pct: billing.vat_rate_bp / 100 })} value={formatMoney(billing.vat_cents, cur)} />
          <Row label={t("total")} value={formatMoney(billing.total_cents, cur)} bold />
        </div>
      )}

      <div className="mt-4">
        {billing.invoice_id ? (
          <Link href={`/admin/invoices/${billing.invoice_id}` as any}
            className="inline-flex items-center gap-1.5 text-sm text-accent-700 hover:underline">
            <FileText className="h-4 w-4" /> {t("viewInvoice", { number: billing.invoice_number ?? "" })}
          </Link>
        ) : billing.billing_status === "billable" ? (
          billing.approval_status === "approved" ? (
            <button onClick={generateInvoice} disabled={busy} className="btn-accent text-sm disabled:opacity-40">
              {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("generating")}</> : <><Receipt className="h-4 w-4" /> {t("generateInvoice")}</>}
            </button>
          ) : billing.approval_status === "sent" ? (
            <p className="text-sm text-amber-700">{t("awaitingApproval")}</p>
          ) : billing.approval_status === "draft" ? (
            <p className="text-sm text-navy-500">{t("draftPending")}</p>
          ) : billing.approval_status === "declined" ? (
            <p className="text-sm text-red-700">{t("approvalDeclinedBilling")}</p>
          ) : (
            <button onClick={requestApproval} disabled={busy} className="btn-accent text-sm disabled:opacity-40">
              {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("requesting")}</> : <><ShieldCheck className="h-4 w-4" /> {t("requestApproval")}</>}
            </button>
          )
        ) : billing.billing_status === "covered" ? (
          <p className="text-sm text-emerald-700">{t("allCovered")}</p>
        ) : null}
      </div>
    </section>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-semibold text-navy-900" : "text-navy-600"}`}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
}
