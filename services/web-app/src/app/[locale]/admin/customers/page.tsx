"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Loader2, Plus, AlertTriangle } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { ShowcaseStatusBadge, computeShowcaseStatus } from "@/components/admin/CustomerShowcasePanel";
import { adminApi, type AdminCustomer } from "@/lib/admin-api";

type ShowcaseFilter = "all" | "live" | "ready" | "pending" | "expiring";

export default function AdminCustomersPage() {
  const t = useTranslations("admin.customers");
  const tc = useTranslations("common");
  const [customers, setCustomers] = useState<AdminCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ slug: "", name: "", industry: "", primary_contact_email: "" });
  const [adding, setAdding] = useState(false);

  const [filter, setFilter] = useState<ShowcaseFilter>("all");
  const filtered = customers.filter((c) => {
    if (filter === "all") return true;
    const s = computeShowcaseStatus(c);
    if (filter === "live")     return s === "live";
    if (filter === "ready")    return s === "consent";
    if (filter === "pending")  return s === "none";
    if (filter === "expiring") return s === "expiring" || s === "expired";
    return true;
  });

  async function load() {
    setLoading(true);
    try {
      const d = await adminApi.listCustomers();
      setCustomers(d.customers ?? []);
    } catch (e: any) {
      setErr(tryMsg(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function add() {
    setErr("");
    setAdding(true);
    try {
      await adminApi.createCustomer(form as any);
      setShowAdd(false);
      setForm({ slug: "", name: "", industry: "", primary_contact_email: "" });
      await load();
    } catch (e: any) {
      setErr(tryMsg(e));
    } finally {
      setAdding(false);
    }
  }

  return (
    <AdminShell>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
          <p className="mt-1 text-sm text-navy-600">{t("subtitle", { count: customers.length })}</p>
        </div>
        <button onClick={() => setShowAdd((v) => !v)} className="btn-accent">
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
          <h3 className="font-semibold text-navy-900">{t("newCustomer")}</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label={t("form.slug")} value={form.slug} onChange={(v) => setForm({ ...form, slug: v })} placeholder={t("form.slugPlaceholder")} />
            <Field label={t("form.name")} value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            <Field label={t("form.industry")} value={form.industry} onChange={(v) => setForm({ ...form, industry: v })} />
            <Field label={t("form.primaryEmail")} value={form.primary_contact_email} onChange={(v) => setForm({ ...form, primary_contact_email: v })} type="email" />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setShowAdd(false)} className="btn-ghost">{tc("cancel")}</button>
            <button onClick={add} disabled={adding || !form.slug || !form.name} className="btn-accent">
              {adding ? <><Loader2 className="h-4 w-4 animate-spin" /> {tc("creating")}</> : tc("create")}
            </button>
          </div>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {(["all", "live", "ready", "pending", "expiring"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              filter === f
                ? "border-accent-500 bg-accent-50 text-accent-800"
                : "border-navy-200 bg-white text-navy-700 hover:bg-navy-50"
            }`}
          >
            {t(`showcaseFilter.${f}`)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-navy-500"><Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}</div>
      ) : customers.length === 0 ? (
        <div className="card text-center text-navy-500">{t("noneYet")}</div>
      ) : filtered.length === 0 ? (
        <div className="card text-center text-navy-500">{t("showcaseFilter.empty")}</div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-navy-50 text-left text-xs uppercase tracking-wider text-navy-500">
              <tr>
                <th className="px-4 py-3 font-semibold">{t("table.name")}</th>
                <th className="px-4 py-3 font-semibold">{t("table.industry")}</th>
                <th className="px-4 py-3 font-semibold">{t("table.services")}</th>
                <th className="px-4 py-3 font-semibold">{t("table.manager")}</th>
                <th className="px-4 py-3 font-semibold">{t("table.showcase")}</th>
                <th className="px-4 py-3 font-semibold">{t("table.status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {filtered.map((c) => (
                <tr key={c.id} className="hover:bg-navy-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/customers/${c.id}` as any} className="font-medium text-navy-900 hover:text-accent-700">
                      {c.name}
                    </Link>
                    <p className="text-xs text-navy-500">{c.slug}</p>
                  </td>
                  <td className="px-4 py-3 text-navy-700">{c.industry ?? "—"}</td>
                  <td className="px-4 py-3 text-navy-700 text-xs">
                    {c.services_used.length === 0 ? "—" : c.services_used.join(", ")}
                  </td>
                  <td className="px-4 py-3 text-navy-700 text-xs">{c.account_manager_name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <ShowcaseStatusBadge customer={c} />
                  </td>
                  <td className="px-4 py-3">
                    {c.is_active ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">{t("table.active")}</span>
                    ) : (
                      <span className="rounded-full bg-navy-100 px-2 py-0.5 text-xs text-navy-700">{t("table.inactive")}</span>
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

function Field({ label, value, onChange, type = "text", placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-navy-800">{label}</label>
      <input
        type={type} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
      />
    </div>
  );
}

function tryMsg(e: any): string {
  if (!e) return "error";
  if (e.body) {
    try { return (JSON.parse(e.body) as { error?: string }).error ?? e.body; } catch { return e.body; }
  }
  return e.message ?? "error";
}
