"use client";

import { useTranslations } from "next-intl";
import { formatMoney } from "./util";
import type { ApprovalItem } from "@/lib/admin-api";

// Renders the bundle of items a customer approves, plus a totals footer for
// priced (quotation) requests. Shared by the admin section, the portal, and the
// public magic-link page. `items` matches the ApprovalItem shape from either
// the admin or the public API (identical fields).
export default function ApprovalItemsTable({
  items,
  currency,
  subtotalCents,
  vatCents,
  totalCents,
  vatRateBp,
}: {
  items: Pick<ApprovalItem, "id" | "item_type" | "label" | "detail_md" | "quantity" | "unit" | "unit_price_cents" | "amount_cents">[];
  currency?: string | null;
  subtotalCents: number;
  vatCents: number;
  totalCents: number;
  vatRateBp: number;
}) {
  const t = useTranslations("approvals.table");
  const priced = totalCents > 0 || items.some((i) => i.item_type === "line");

  if (items.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-navy-100 text-left text-[11px] uppercase tracking-wider text-navy-500">
            <th className="py-1.5 pr-3">{t("item")}</th>
            {priced && <th className="py-1.5 px-3 text-right whitespace-nowrap">{t("qty")}</th>}
            {priced && <th className="py-1.5 px-3 text-right whitespace-nowrap">{t("unitPrice")}</th>}
            {priced && <th className="py-1.5 pl-3 text-right whitespace-nowrap">{t("amount")}</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} className="border-b border-navy-50 align-top">
              <td className="py-2 pr-3">
                <div className="font-medium text-navy-900">{it.label}</div>
                {it.detail_md && <div className="mt-0.5 text-xs text-navy-500">{it.detail_md}</div>}
              </td>
              {priced && (
                <td className="py-2 px-3 text-right tabular-nums text-navy-700">
                  {it.quantity ?? ""}{it.unit ? ` ${it.unit}` : ""}
                </td>
              )}
              {priced && (
                <td className="py-2 px-3 text-right tabular-nums text-navy-700">
                  {it.unit_price_cents != null ? formatMoney(it.unit_price_cents, currency) : ""}
                </td>
              )}
              {priced && (
                <td className="py-2 pl-3 text-right tabular-nums text-navy-900">
                  {formatMoney(it.amount_cents, currency)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
        {priced && (
          <tfoot className="text-sm">
            <tr>
              <td colSpan={3} className="py-1.5 pr-3 text-right text-navy-500">{t("subtotal")}</td>
              <td className="py-1.5 pl-3 text-right tabular-nums text-navy-800">{formatMoney(subtotalCents, currency)}</td>
            </tr>
            <tr>
              <td colSpan={3} className="py-1.5 pr-3 text-right text-navy-500">
                {t("vat", { rate: (vatRateBp / 100).toString() })}
              </td>
              <td className="py-1.5 pl-3 text-right tabular-nums text-navy-800">{formatMoney(vatCents, currency)}</td>
            </tr>
            <tr className="border-t border-navy-200">
              <td colSpan={3} className="py-1.5 pr-3 text-right font-semibold text-navy-900">{t("total")}</td>
              <td className="py-1.5 pl-3 text-right font-semibold tabular-nums text-navy-900">{formatMoney(totalCents, currency)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
