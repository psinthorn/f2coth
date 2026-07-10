"use client";

// Shared UI + helpers for the contracts admin feature. Colocated so the status
// palette, formatting and small widgets live once and every contracts page
// (list, detail, wizard) reuses them.
import { useTranslations } from "next-intl";
import type { ContractStatus } from "@/lib/contract-api";

// Status → Tailwind classes. Palette per spec: draft grey · sent amber ·
// signed green · active navy · expired red · terminated slate.
export const STATUS_STYLE: Record<ContractStatus, string> = {
  draft: "bg-navy-100 text-navy-600",
  sent: "bg-amber-100 text-amber-700",
  signed: "bg-green-100 text-green-700",
  active: "bg-navy-800 text-white",
  expired: "bg-red-100 text-red-700",
  terminated: "bg-slate-200 text-slate-600",
};

export const ALL_STATUSES: ContractStatus[] = [
  "draft", "sent", "signed", "active", "expired", "terminated",
];

export function StatusBadge({ status }: { status: ContractStatus }) {
  const t = useTranslations("admin.contracts");
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[status] ?? STATUS_STYLE.draft}`}>
      {t(`status.${status}`)}
    </span>
  );
}

export function formatTHB(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(v) + " THB";
}

export function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  return d.slice(0, 10);
}

// Days until end_date; negative = past. Null when no end date.
export function daysUntil(endDate: string | null | undefined): number | null {
  if (!endDate) return null;
  const end = new Date(endDate + "T00:00:00");
  const now = new Date();
  const ms = end.getTime() - now.getTime();
  return Math.ceil(ms / 86_400_000);
}

// True when an active contract ends within `within` days (renewal reminder).
export function isExpiringSoon(c: { status: string; end_date?: string | null }, within = 30): boolean {
  if (c.status !== "active") return false;
  const d = daysUntil(c.end_date);
  return d !== null && d >= 0 && d <= within;
}
