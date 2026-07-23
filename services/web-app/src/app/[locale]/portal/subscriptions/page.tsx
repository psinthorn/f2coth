"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Repeat, Ban } from "lucide-react";
import PortalShell from "@/components/PortalShell";
import { useBusyAction } from "@/lib/toast";
import { portalApi, type PortalSubscription } from "@/lib/portal-api";
import { formatMoney } from "@/lib/payment-types";

export default function PortalSubscriptionsPage() {
  const t = useTranslations("portal.subscriptions");
  const tc = useTranslations("common");
  const { busy, run } = useBusyAction();
  const [rows, setRows] = useState<PortalSubscription[] | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  function load() {
    setRows(null);
    portalApi.listSubscriptions().then(setRows).catch(() => setRows([]));
  }
  useEffect(() => {
    load();
  }, []);

  async function cancel(id: string) {
    const ok = await run(() => portalApi.cancelSubscription(id), { success: tc("toast.updated") });
    if (ok) load();
    setConfirmId(null);
  }

  const statusTone: Record<string, string> = {
    active: "bg-emerald-50 text-emerald-700",
    paused: "bg-amber-50 text-amber-800",
    cancelled: "bg-navy-100 text-navy-500",
  };

  return (
    <PortalShell>
      <header className="mb-6">
        <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-navy-600">{t("subtitle")}</p>
      </header>

      {!rows ? (
        <div className="flex items-center gap-2 text-navy-500">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("loading")}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-navy-200 bg-white p-8 text-center text-navy-500">
          <Repeat className="mx-auto mb-2 h-6 w-6 text-navy-300" />
          {t("empty")}
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((s) => (
            <div key={s.id} className="rounded-xl border border-navy-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-medium text-navy-900">{s.title}</h2>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${statusTone[s.status] ?? ""}`}>
                      {t(`status.${s.status}`)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-navy-600">
                    {formatMoney(s.amount_cents, s.currency)} · {t(`cycles.${s.billing_cycle}`)}
                  </p>
                  <p className="mt-0.5 text-xs text-navy-500">
                    {s.status === "cancelled" && s.ends_on
                      ? t("paidThrough", { date: s.ends_on })
                      : t("renewsOn", { date: s.next_billing_at })}
                  </p>
                </div>
                {s.status === "active" && (
                  confirmId === s.id ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-navy-600">{t("confirm")}</span>
                      <button
                        type="button"
                        className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                        disabled={busy}
                        onClick={() => cancel(s.id)}
                      >
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("confirmYes")}
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-navy-200 px-3 py-1.5 text-xs text-navy-600"
                        onClick={() => setConfirmId(null)}
                      >
                        {t("keep")}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-lg border border-navy-200 px-3 py-1.5 text-xs text-navy-700 hover:bg-navy-50"
                      onClick={() => setConfirmId(s.id)}
                    >
                      <Ban className="h-3.5 w-3.5" /> {t("cancel")}
                    </button>
                  )
                )}
              </div>
            </div>
          ))}
          <p className="pt-2 text-xs text-navy-400">{t("cancelNote")}</p>
        </div>
      )}
    </PortalShell>
  );
}
