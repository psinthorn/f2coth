import { APPROVAL_STATUS_COLOR } from "./util";

// Dumb status pill — caller passes the already-translated label so the badge
// works under any i18n namespace (admin / portal / public page).
export default function ApprovalStatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs ${
        APPROVAL_STATUS_COLOR[status] ?? "bg-navy-100 text-navy-700"
      }`}
    >
      {label}
    </span>
  );
}
