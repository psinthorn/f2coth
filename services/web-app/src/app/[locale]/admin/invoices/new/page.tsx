"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Plus, Trash2, ChevronLeft } from "lucide-react";
import { Link } from "@/i18n/routing";
import AdminShell from "@/components/AdminShell";
import { toast } from "@/lib/toast";
import { adminApi, type AdminCustomer, type AdminCreateInvoiceInput } from "@/lib/admin-api";
import { formatMoney } from "@/lib/payment-types";

type ItemRow = AdminCreateInvoiceInput["items"][number];

const EMPTY_ITEM: ItemRow = {
  product_type: "custom",
  description_en: "",
  description_th: "",
  quantity: 1,
  unit_price_cents: 0,
};

export default function AdminNewInvoicePage() {
  const t = useTranslations("admin.invoices");
  const tc = useTranslations("common");
  const router = useRouter();

  const [customers, setCustomers] = useState<AdminCustomer[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [currency, setCurrency] = useState<"THB" | "USD">("THB");
  const [vatRateBP, setVatRateBP] = useState(700);
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ItemRow[]>([{ ...EMPTY_ITEM }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    adminApi.listCustomers().then((r) => setCustomers(r.customers ?? [])).catch(() => setCustomers([]));
  }, []);

  const subtotal = items.reduce((acc, it) => acc + (it.quantity || 0) * (it.unit_price_cents || 0), 0);
  const vat = Math.round((subtotal * vatRateBP) / 10000);
  const total = subtotal + vat;

  function patchItem(i: number, patch: Partial<ItemRow>) {
    setItems((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!customerId) {
      setErr(t("pickCustomer"));
      return;
    }
    if (items.length === 0 || items.some((it) => !it.description_en || it.quantity < 1 || it.unit_price_cents < 0)) {
      setErr(t("invalidItems"));
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const r = await adminApi.createInvoice({
        customer_id: customerId,
        currency,
        vat_rate_bp: vatRateBP,
        due_date: dueDate || undefined,
        notes: notes || undefined,
        items,
      });
      toast.success(tc("toast.added"));
      router.push(`/admin/invoices/${r.id}`);
    } catch (e: unknown) {
      const v = e as { body?: string };
      setErr(v.body || tc("error"));
      toast.error(v.body || tc("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell>
      <div className="mb-3 text-xs">
        <Link href="/admin/invoices" className="text-navy-500 hover:text-navy-700">
          <ChevronLeft className="inline h-3 w-3" /> {t("backToList")}
        </Link>
      </div>
      <h1 className="mb-6 font-display text-3xl text-navy-900">{t("create")}</h1>

      <form onSubmit={submit} className="space-y-6">
        <section className="card">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1 text-xs text-navy-600">
              {t("col.customer")} *
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="rounded-md border border-navy-200 px-3 py-2 text-sm"
                required
              >
                <option value="">—</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs text-navy-600">
              {t("currency")}
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as "THB" | "USD")}
                className="rounded-md border border-navy-200 px-3 py-2 text-sm"
              >
                <option value="THB">THB (฿)</option>
                <option value="USD">USD ($)</option>
              </select>
            </label>
            <label className="grid gap-1 text-xs text-navy-600">
              {t("vatLabel")} (basis points)
              <input
                type="number"
                min={0}
                max={10000}
                value={vatRateBP}
                onChange={(e) => setVatRateBP(Number(e.target.value))}
                className="rounded-md border border-navy-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="grid gap-1 text-xs text-navy-600">
              {t("col.due")}
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="rounded-md border border-navy-200 px-3 py-2 text-sm"
              />
            </label>
          </div>
          <label className="mt-4 grid gap-1 text-xs text-navy-600">
            {t("notes")}
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="rounded-md border border-navy-200 px-3 py-2 text-sm"
            />
          </label>
        </section>

        <section className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg text-navy-900">{t("items")}</h2>
            <button
              type="button"
              onClick={() => setItems([...items, { ...EMPTY_ITEM }])}
              className="btn-secondary"
            >
              <Plus className="h-4 w-4" /> {t("addItem")}
            </button>
          </div>
          <div className="space-y-3">
            {items.map((it, i) => (
              <div key={i} className="grid gap-2 rounded-md border border-navy-100 p-3 sm:grid-cols-12">
                <select
                  value={it.product_type}
                  onChange={(e) => patchItem(i, { product_type: e.target.value as ItemRow["product_type"] })}
                  className="sm:col-span-2 rounded-md border border-navy-200 px-2 py-1.5 text-xs"
                >
                  <option value="custom">custom</option>
                  <option value="domain">domain</option>
                  <option value="hosting">hosting</option>
                  <option value="sla">sla</option>
                  <option value="msp">msp</option>
                </select>
                <input
                  type="text"
                  placeholder={t("descEN")}
                  value={it.description_en}
                  onChange={(e) => patchItem(i, { description_en: e.target.value })}
                  className="sm:col-span-3 rounded-md border border-navy-200 px-2 py-1.5 text-sm"
                />
                <input
                  type="text"
                  placeholder={t("descTH")}
                  value={it.description_th ?? ""}
                  onChange={(e) => patchItem(i, { description_th: e.target.value })}
                  className="sm:col-span-3 rounded-md border border-navy-200 px-2 py-1.5 text-sm"
                />
                <input
                  type="number"
                  min={1}
                  value={it.quantity}
                  onChange={(e) => patchItem(i, { quantity: Number(e.target.value) })}
                  className="sm:col-span-1 rounded-md border border-navy-200 px-2 py-1.5 text-sm"
                />
                <input
                  type="number"
                  min={0}
                  value={it.unit_price_cents}
                  onChange={(e) => patchItem(i, { unit_price_cents: Number(e.target.value) })}
                  className="sm:col-span-2 rounded-md border border-navy-200 px-2 py-1.5 text-sm"
                  placeholder={t("unitPriceCents")}
                />
                <button
                  type="button"
                  onClick={() => setItems(items.filter((_, idx) => idx !== i))}
                  className="sm:col-span-1 rounded-md border border-red-200 text-red-700 hover:bg-red-50"
                >
                  <Trash2 className="mx-auto h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-1 text-right text-sm">
            <p>{t("subtotal")}: {formatMoney(subtotal, currency)}</p>
            <p>{t("vat", { rate: (vatRateBP / 100).toFixed(2) })}: {formatMoney(vat, currency)}</p>
            <p className="font-semibold text-navy-900">{t("total")}: {formatMoney(total, currency)}</p>
          </div>
        </section>

        {err && <p className="text-red-700 text-sm">{err}</p>}

        <div className="flex justify-end">
          <button type="submit" className="btn-accent" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("createDraft")}
          </button>
        </div>
      </form>
    </AdminShell>
  );
}
