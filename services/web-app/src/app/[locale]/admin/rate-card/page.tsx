"use client";

// /admin/rate-card — manage the price book of services/products used to itemize
// billable ticket work (migration 073).

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Plus, AlertTriangle, Pencil, X } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { useBusyAction } from "@/lib/toast";
import { formatMoney } from "@/lib/payment-types";
import { adminApi, type RateCardItem } from "@/lib/admin-api";

type FormState = {
  name_en: string; name_th: string; unit: string; price: number;
  currency: "THB" | "USD"; category: string; code: string;
};
const blank: FormState = { name_en: "", name_th: "", unit: "item", price: 0, currency: "THB", category: "", code: "" };

export default function AdminRateCardPage() {
  const t = useTranslations("admin.rateCard");
  const { busy, run } = useBusyAction();
  const [items, setItems] = useState<RateCardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<FormState>(blank);
  const [editId, setEditId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try { setItems((await adminApi.listRateCard()).items ?? []); }
    catch (e: any) { setErr(e?.message ?? "error"); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function save() {
    const payload = {
      name_en: form.name_en.trim(), name_th: form.name_th.trim() || undefined,
      unit: form.unit.trim() || "item", default_unit_price_cents: Math.round(Number(form.price) * 100),
      currency: form.currency, category: form.category.trim() || undefined,
      code: form.code.trim() || undefined,
    };
    const ok = await run(
      () => (editId ? adminApi.updateRateCard(editId, payload) : adminApi.createRateCard(payload)),
      { success: t("saved") },
    );
    if (ok) { setShowAdd(false); setEditId(null); setForm(blank); await load(); }
  }

  async function toggleActive(it: RateCardItem) {
    const ok = await run(() => adminApi.updateRateCard(it.id, { is_active: !it.is_active }), { success: t("saved") });
    if (ok) await load();
  }

  function startEdit(it: RateCardItem) {
    setEditId(it.id);
    setForm({
      name_en: it.name_en, name_th: it.name_th ?? "", unit: it.unit,
      price: it.default_unit_price_cents / 100, currency: it.currency,
      category: it.category ?? "", code: it.code ?? "",
    });
    setShowAdd(true);
  }

  return (
    <AdminShell>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
          <p className="mt-1 text-sm text-navy-600">{t("subtitle")}</p>
        </div>
        <button onClick={() => { setEditId(null); setForm(blank); setShowAdd((v) => !v); }} className="btn-accent">
          <Plus className="h-4 w-4" /> {t("addButton")}
        </button>
      </header>

      {err && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4" /><span>{err}</span>
        </div>
      )}

      {showAdd && (
        <div className="card mb-6">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-navy-900">{editId ? t("editItem") : t("newItem")}</h3>
            <button onClick={() => { setShowAdd(false); setEditId(null); }} className="text-navy-400 hover:text-navy-700"><X className="h-4 w-4" /></button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label={t("nameEn")} value={form.name_en} onChange={(v) => setForm({ ...form, name_en: v })} />
            <Field label={t("nameTh")} value={form.name_th} onChange={(v) => setForm({ ...form, name_th: v })} />
            <Field label={t("unit")} value={form.unit} onChange={(v) => setForm({ ...form, unit: v })} />
            <Field label={t("rate", { cur: form.currency })} type="number" value={String(form.price)} onChange={(v) => setForm({ ...form, price: Number(v) || 0 })} />
            <Field label={t("category")} value={form.category} onChange={(v) => setForm({ ...form, category: v })} />
            <Field label={t("code")} value={form.code} onChange={(v) => setForm({ ...form, code: v })} />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => { setShowAdd(false); setEditId(null); }} className="btn-ghost">{t("cancel")}</button>
            <button onClick={save} disabled={busy || !form.name_en.trim()} className="btn-accent disabled:opacity-40">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("save")}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid place-items-center py-10 text-navy-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : items.length === 0 ? (
        <p className="text-sm text-navy-500">{t("empty")}</p>
      ) : (
        <div className="card divide-y divide-navy-100 p-0">
          {items.map((it) => (
            <div key={it.id} className={`flex items-center justify-between gap-3 px-4 py-3 ${it.is_active ? "" : "opacity-50"}`}>
              <div className="min-w-0">
                <p className="truncate font-medium text-navy-900">{it.name_en}{it.name_th ? ` · ${it.name_th}` : ""}</p>
                <p className="text-xs text-navy-500">
                  {formatMoney(it.default_unit_price_cents, it.currency)}/{it.unit}
                  {it.category ? ` · ${it.category}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button onClick={() => toggleActive(it)} disabled={busy}
                  className={`rounded-full px-2 py-0.5 text-[11px] ${it.is_active ? "bg-emerald-50 text-emerald-700" : "bg-navy-100 text-navy-600"}`}>
                  {it.is_active ? t("active") : t("inactive")}
                </button>
                <button onClick={() => startEdit(it)} className="text-navy-400 hover:text-accent-700" aria-label={t("edit")}>
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminShell>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-navy-800">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none" />
    </div>
  );
}
