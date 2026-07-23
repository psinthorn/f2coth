"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { subscribeToasts, dismissToast, type ToastItem } from "@/lib/toast";

const STYLE: Record<ToastItem["kind"], { cls: string; Icon: typeof Info }> = {
  success: { cls: "border-green-200 bg-green-50 text-green-800", Icon: CheckCircle2 },
  error: { cls: "border-red-200 bg-red-50 text-red-700", Icon: AlertCircle },
  info: { cls: "border-navy-200 bg-white text-navy-800", Icon: Info },
};

// Renders active toasts bottom-right. Mount once (AdminShell). Empty until a
// toast fires, so it costs nothing on pages that never call toast().
export default function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => subscribeToasts(setItems), []);
  if (!items.length) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(92vw,22rem)] flex-col gap-2">
      {items.map((t) => {
        const { cls, Icon } = STYLE[t.kind];
        return (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-lg ${cls}`}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1 break-words">{t.message}</span>
            <button onClick={() => dismissToast(t.id)} className="shrink-0 opacity-60 hover:opacity-100" aria-label="Dismiss">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
