"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Plus, RotateCcw, Pause, Play, X } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { toast, useBusyAction } from "@/lib/toast";
import {
  adminApi,
  type AdminSubscription,
  type AdminCustomer,
  type AdminSubscriptionInput,
  type PaymentCatalog,
} from "@/lib/admin-api";
import { formatMoney } from "@/lib/payment-types";

const STATUSES = ["", "active", "paused", "cancelled"] as const;

export default function AdminSubscriptionsPage() {
  const t = useTranslations("admin.subscriptions");
  const tc = useTranslations("common");
  const [rows, setRows] = useState<AdminSubscription[] | null>(null);
  const [status, setStatus] = useState<string>("");
  const [showCreate, setShowCreate] = useState(false);
  const [customers, setCustomers] = useState<AdminCustomer[]>([]);
  const { busy, run } = useBusyAction();

  function load() {
    setRows(null);
    adminApi.listSubscriptions(status ? { status } : undefined).then(setRows).catch(() => setRows([]));
  }
  useEffect(() => {
    load();
    adminApi.listCustomers().then((r) => setCustomers(r.customers ?? [])).catch(() => setCustomers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function changeStatus(id: string, next: "active" | "paused" | "cancelled") {
    const ok = await run(() => adminApi.setSubscriptionStatus(id, next), { success: tc("toast.updated") });
    if (ok) load();
  }

  return (
    <AdminShell>
      <header className="mb-6 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
          <p className="mt-1 text-sm text-navy-600">{t("subtitle")}</p>
        </div>
        <button type="button" className="btn-accent" onClick={() => setShowCreate(!showCreate)}>
          <Plus className="h-4 w-4" /> {t("create")}
        </button>
      </header>

      <div className="mb-4 flex flex-wrap gap-2 text-xs">
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

      {showCreate && (
        <CreateSubscription
          customers={customers}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}

      {rows === null ? (
        <div className="text-navy-500"><Loader2 className="inline h-4 w-4 animate-spin" /> {tc("loading")}</div>
      ) : rows.length === 0 ? (
        <div className="card text-center text-navy-500">{t("empty")}</div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-navy-50 text-left text-xs uppercase tracking-wider text-navy-500">
              <tr>
                <th className="px-4 py-3 font-semibold">{t("col.title")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.customer")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.product")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.cycle")}</th>
                <th className="px-4 py-3 font-semibold text-right">{t("col.amount")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.nextBilling")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.status")}</th>
                <th className="px-4 py-3 font-semibold">{t("col.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {rows.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-3 font-medium">{s.title}</td>
                  <td className="px-4 py-3 text-navy-700">{s.customer_name}</td>
                  <td className="px-4 py-3 text-navy-600 text-xs uppercase">{s.product_type}</td>
                  <td className="px-4 py-3 text-navy-600 text-xs">{t(`cycle.${s.billing_cycle}`)}</td>
                  <td className="px-4 py-3 text-right">{formatMoney(s.amount_cents, s.currency)}</td>
                  <td className="px-4 py-3 text-xs">{s.next_billing_at ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${
                      s.status === "active" ? "bg-emerald-50 text-emerald-800"
                      : s.status === "paused" ? "bg-amber-50 text-amber-800"
                      : "bg-navy-100 text-navy-700"
                    }`}>
                      {t(`status.${s.status}`)}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap space-x-1">
                    {s.status === "active" && (
                      <button type="button" onClick={() => changeStatus(s.id, "paused")} disabled={busy}
                        className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900 hover:bg-amber-100 disabled:opacity-40">
                        <Pause className="inline h-3 w-3" /> {t("pause")}
                      </button>
                    )}
                    {s.status === "paused" && (
                      <button type="button" onClick={() => changeStatus(s.id, "active")} disabled={busy}
                        className="rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-100 disabled:opacity-40">
                        <Play className="inline h-3 w-3" /> {t("resume")}
                      </button>
                    )}
                    {s.status !== "cancelled" && (
                      <button type="button" onClick={() => changeStatus(s.id, "cancelled")} disabled={busy}
                        className="rounded-md bg-red-50 px-2 py-1 text-xs text-red-800 hover:bg-red-100 disabled:opacity-40">
                        <X className="inline h-3 w-3" /> {t("cancel")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}

function CreateSubscription({
  customers, onClose, onCreated,
}: {
  customers: AdminCustomer[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useTranslations("admin.subscriptions");
  const tc = useTranslations("common");
  const [form, setForm] = useState<AdminSubscriptionInput>({
    customer_id: "",
    title: "",
    product_type: "custom",
    billing_cycle: "monthly",
    amount_cents: 0,
    currency: "THB",
    starts_on: new Date().toISOString().slice(0, 10),
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<PaymentCatalog | null>(null);

  // Re-fetch catalog whenever the customer changes (SLA list is per-customer).
  useEffect(() => {
    if (!form.customer_id) { setCatalog(null); return; }
    adminApi.paymentCatalog(form.customer_id).then(setCatalog).catch(() => setCatalog(null));
  }, [form.customer_id]);

  // Apply a product pick (hosting plan or SLA contract): auto-fills
  // title + product_type + product_ref + amount based on the chosen
  // billing cycle. Admins can still tweak any field after pick.
  function pickProduct(key: string) {
    if (!key || !catalog) return;
    if (key.startsWith("hosting:")) {
      const id = key.slice("hosting:".length);
      const h = catalog.hosting.find((x) => x.id === id);
      if (!h) return;
      const useAnnual = form.billing_cycle === "annually";
      setForm({
        ...form,
        title: h.name_en + (useAnnual ? " (Annual)" : " (Monthly)"),
        product_type: "hosting",
        product_ref: h.id,
        amount_cents: useAnnual ? h.annually_cents : h.monthly_cents,
        billing_cycle: useAnnual ? "annually" : "monthly",
      });
    } else if (key.startsWith("sla:")) {
      const id = key.slice("sla:".length);
      const s = catalog.sla.find((x) => x.id === id);
      if (!s) return;
      setForm({
        ...form,
        title: s.title,
        product_type: "sla",
        product_ref: s.id,
        billing_cycle: "annually", // SLA contracts default to annual renewal
      });
    }
  }

  async function submit() {
    if (busy) return;
    if (!form.customer_id || !form.title || form.amount_cents <= 0) {
      setErr(t("invalid"));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await adminApi.createSubscription(form);
      toast.success(tc("toast.added"));
      onCreated();
    } catch (e: unknown) {
      const v = e as { body?: string };
      const msg = v.body || "error";
      setErr(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card mb-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg">{t("create")}</h2>
        <button type="button" onClick={onClose} className="text-navy-400 hover:text-navy-700">
          <RotateCcw className="h-4 w-4" />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs">
          {t("col.customer")}
          <select value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}
            className="rounded-md border border-navy-200 px-3 py-2 text-sm">
            <option value="">—</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        {catalog && (catalog.hosting.length > 0 || catalog.sla.length > 0) && (
          <label className="grid gap-1 text-xs">
            {t("pickFromCatalog")}
            <select
              onChange={(e) => pickProduct(e.target.value)}
              className="rounded-md border border-navy-200 px-3 py-2 text-sm"
              defaultValue=""
            >
              <option value="">{t("custom")}</option>
              {catalog.hosting.length > 0 && (
                <optgroup label={t("catalogHosting")}>
                  {catalog.hosting.map((h) => (
                    <option key={h.id} value={`hosting:${h.id}`}>
                      {h.name_en} — ฿{(h.monthly_cents / 100).toLocaleString()}/mo · ฿{(h.annually_cents / 100).toLocaleString()}/yr
                    </option>
                  ))}
                </optgroup>
              )}
              {catalog.sla.length > 0 && (
                <optgroup label={t("catalogSLA")}>
                  {catalog.sla.map((s) => (
                    <option key={s.id} value={`sla:${s.id}`}>{s.title} ({s.starts_on} → {s.ends_on})</option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
        )}
        <label className="grid gap-1 text-xs">
          {t("col.title")}
          <input type="text" value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="rounded-md border border-navy-200 px-3 py-2 text-sm" />
        </label>
        <label className="grid gap-1 text-xs">
          {t("col.product")}
          <select value={form.product_type}
            onChange={(e) => setForm({ ...form, product_type: e.target.value as never })}
            className="rounded-md border border-navy-200 px-3 py-2 text-sm">
            <option value="hosting">hosting</option>
            <option value="sla">sla</option>
            <option value="msp">msp</option>
            <option value="custom">custom</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs">
          {t("col.cycle")}
          <select value={form.billing_cycle}
            onChange={(e) => setForm({ ...form, billing_cycle: e.target.value as never })}
            className="rounded-md border border-navy-200 px-3 py-2 text-sm">
            <option value="monthly">monthly</option>
            <option value="quarterly">quarterly</option>
            <option value="annually">annually</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs">
          {t("amountCents")}
          <input type="number" min={0} value={form.amount_cents}
            onChange={(e) => setForm({ ...form, amount_cents: Number(e.target.value) })}
            className="rounded-md border border-navy-200 px-3 py-2 text-sm" />
        </label>
        <label className="grid gap-1 text-xs">
          {t("startsOn")}
          <input type="date" value={form.starts_on}
            onChange={(e) => setForm({ ...form, starts_on: e.target.value })}
            className="rounded-md border border-navy-200 px-3 py-2 text-sm" />
        </label>
      </div>
      {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
      <div className="mt-3 flex justify-end">
        <button type="button" onClick={submit} disabled={busy} className="btn-accent">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t("create")}
        </button>
      </div>
    </section>
  );
}
