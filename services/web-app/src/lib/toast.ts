"use client";
// Tiny app-wide toast store + a busy-action hook. No provider/context wiring:
// any component can `import { toast } from "@/lib/toast"` and call it, and a
// single <Toaster/> (mounted in AdminShell) renders them. useBusyAction wraps an
// async handler so a button can't be double-clicked while its first run is in
// flight, and reports success/failure as a toast.
import { useState } from "react";

export type ToastKind = "success" | "error" | "info";
export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

let items: ToastItem[] = [];
let listeners: ((items: ToastItem[]) => void)[] = [];
let seq = 1;

function emit() {
  for (const l of listeners) l(items);
}

export function subscribeToasts(l: (items: ToastItem[]) => void): () => void {
  listeners.push(l);
  l(items);
  return () => { listeners = listeners.filter((x) => x !== l); };
}

export function dismissToast(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

function push(kind: ToastKind, message: string, ttl: number) {
  const id = seq++;
  items = [...items, { id, kind, message }];
  emit();
  if (typeof window !== "undefined") window.setTimeout(() => dismissToast(id), ttl);
  return id;
}

export const toast = {
  success: (m: string) => push("success", m, 3500),
  error: (m: string) => push("error", m, 6000),
  info: (m: string) => push("info", m, 3500),
};

// useBusyAction returns a `busy` flag (for disabling the button) and `run`,
// which ignores re-entry while a call is in flight and toasts the outcome.
export function useBusyAction() {
  const [busy, setBusy] = useState(false);
  async function run(
    fn: () => Promise<unknown>,
    opts?: { success?: string; error?: string },
  ): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    try {
      await fn();
      if (opts?.success) toast.success(opts.success);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(opts?.error ? `${opts.error}: ${msg}` : msg);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, run };
}
