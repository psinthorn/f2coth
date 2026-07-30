// Shared helpers for the approval UI (admin + portal + public magic-link page).

export function formatMoney(cents: number, currency?: string | null): string {
  const sym = currency === "USD" ? "$" : "฿";
  const v = (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sym}${v}`;
}

// Status → Tailwind pill classes, matching the ticket/invoice status palette.
export const APPROVAL_STATUS_COLOR: Record<string, string> = {
  draft: "bg-navy-100 text-navy-700",
  sent: "bg-amber-50 text-amber-800",
  approved: "bg-emerald-50 text-emerald-800",
  declined: "bg-red-50 text-red-800",
  cancelled: "bg-navy-100 text-navy-500",
  expired: "bg-navy-100 text-navy-500",
};
