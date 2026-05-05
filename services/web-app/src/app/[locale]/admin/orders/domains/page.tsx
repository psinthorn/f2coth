"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Plus, X } from "lucide-react";
import { Link } from "@/i18n/routing";
import AdminShell from "@/components/AdminShell";
import { adminApi, type AdminDomainOrder, type DomainOrderStatus, type NewDomainOrder } from "@/lib/admin-api";

const STATUSES: DomainOrderStatus[] = [
  "pending", "quoted", "approved", "registered", "active", "rejected", "cancelled", "failed",
];

export default function AdminDomainOrdersPage() {
  const t = useTranslations("admin.orders");
  const tc = useTranslations("common");
  const [orders, setOrders] = useState<AdminDomainOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState<DomainOrderStatus | "">("");
  const [showCreate, setShowCreate] = useState(false);

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const data = await adminApi.listDomainOrders(filter || undefined);
      setOrders(data.orders ?? []);
    } catch (e: any) {
      setErr(e?.body ?? e?.message ?? "error");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  const filtered = useMemo(() => orders, [orders]);

  return (
    <AdminShell>
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
          <p className="mt-1 text-sm text-navy-600">{t("subtitle")}</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-accent shrink-0">
          <Plus className="h-4 w-4" /> {t("newOrder")}
        </button>
      </header>

      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <button
          onClick={() => setFilter("")}
          className={`rounded-full px-3 py-1 ${filter === "" ? "bg-navy-900 text-white" : "bg-navy-100 text-navy-700"}`}
        >
          {t("filterAll")}
        </button>
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded-full px-3 py-1 ${filter === s ? "bg-navy-900 text-white" : "bg-navy-100 text-navy-700"}`}
          >
            {t(`statuses.${s}`)}
          </button>
        ))}
      </div>

      {err && <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{err}</div>}

      {loading ? (
        <div className="flex items-center gap-2 text-navy-500"><Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}</div>
      ) : filtered.length === 0 ? (
        <div className="card text-navy-500">{t("empty")}</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-navy-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-navy-50 text-left text-xs uppercase tracking-wider text-navy-500">
              <tr>
                <th className="px-4 py-3">{t("headers.fqdn")}</th>
                <th className="px-4 py-3">{t("headers.registry")}</th>
                <th className="px-4 py-3">{t("headers.status")}</th>
                <th className="px-4 py-3">{t("headers.years")}</th>
                <th className="px-4 py-3">{t("headers.customer")}</th>
                <th className="px-4 py-3">{t("headers.created")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {filtered.map((o) => (
                <tr key={o.id}>
                  <td className="px-4 py-3 font-medium text-navy-900">
                    <Link href={`/admin/orders/domains/${o.id}` as never} className="hover:text-accent-700">
                      {o.fqdn}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-navy-700">
                    <span className="rounded-full bg-navy-100 px-2 py-0.5 text-xs">{o.registry}</span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={o.status} label={t(`statuses.${o.status}`)} />
                  </td>
                  <td className="px-4 py-3 text-navy-700">{o.years}</td>
                  <td className="px-4 py-3 text-xs text-navy-600">
                    {o.customer_id ? `customer:${o.customer_id.slice(0, 8)}` : o.lead_id ? `lead:${o.lead_id.slice(0, 8)}` : (o.contact_email ?? "—")}
                  </td>
                  <td className="px-4 py-3 text-xs text-navy-500">{new Date(o.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateOrderModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}
    </AdminShell>
  );
}

function StatusPill({ status, label }: { status: DomainOrderStatus; label: string }) {
  const cls =
    status === "active" || status === "registered" ? "bg-emerald-50 text-emerald-800" :
    status === "approved" ? "bg-blue-50 text-blue-800" :
    status === "quoted" ? "bg-violet-50 text-violet-800" :
    status === "rejected" || status === "failed" || status === "cancelled" ? "bg-red-50 text-red-800" :
    "bg-amber-50 text-amber-800";
  return <span className={`rounded-full px-2 py-0.5 text-xs ${cls}`}>{label}</span>;
}

function CreateOrderModal({
  onClose, onCreated,
}: { onClose: () => void; onCreated: () => void }) {
  const t = useTranslations("admin.orders.create");
  const tc = useTranslations("common");
  const [form, setForm] = useState<NewDomainOrder>({
    sld: "",
    tld: "com",
    registry: "resellerclub",
    contact_name: "",
    contact_email: "",
    years: 1,
    privacy_enabled: true,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.sld || !form.tld || !form.contact_name || !form.contact_email) {
      setErr(t("errorRequired"));
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await adminApi.createDomainOrder(form);
      onCreated();
    } catch (e: any) {
      setErr(e?.body ?? e?.message ?? "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-navy-900/40 p-4">
      <form onSubmit={submit} className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl text-navy-900">{t("title")}</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1 hover:bg-navy-50">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Input label={t("sld")} value={form.sld} onChange={(v) => setForm({ ...form, sld: v })} required />
          <Input label={t("tld")} value={form.tld} onChange={(v) => setForm({ ...form, tld: v })} required />
          <div className="flex flex-col gap-1">
            <label className="text-xs text-navy-700">{t("registry")}</label>
            <select
              value={form.registry}
              onChange={(e) => setForm({ ...form, registry: e.target.value as "thnic" | "resellerclub" })}
              className="rounded-lg border border-navy-200 px-3 py-2 text-sm"
            >
              <option value="resellerclub">resellerclub</option>
              <option value="thnic">thnic</option>
            </select>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input label={t("contactName")} value={form.contact_name} onChange={(v) => setForm({ ...form, contact_name: v })} required />
          <Input label={t("contactEmail")} type="email" value={form.contact_email} onChange={(v) => setForm({ ...form, contact_email: v })} required />
          <Input label={t("contactPhone")} value={form.contact_phone ?? ""} onChange={(v) => setForm({ ...form, contact_phone: v })} />
          <Input label={t("contactCompany")} value={form.contact_company ?? ""} onChange={(v) => setForm({ ...form, contact_company: v })} />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-navy-700">{t("years")}</label>
            <input
              type="number" min={1} max={10}
              value={form.years}
              onChange={(e) => setForm({ ...form, years: Math.max(1, parseInt(e.target.value) || 1) })}
              className="rounded-lg border border-navy-200 px-3 py-2 text-sm"
            />
          </div>
          <label className="mt-5 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.privacy_enabled}
              onChange={(e) => setForm({ ...form, privacy_enabled: e.target.checked })}
            />
            {t("privacy")}
          </label>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-navy-700">{t("notes")}</label>
          <textarea
            value={form.notes ?? ""}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={2}
            className="rounded-lg border border-navy-200 px-3 py-2 text-sm"
          />
        </div>
        {err && <div className="rounded-lg bg-red-50 p-2 text-sm text-red-800">{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-navy-700 hover:bg-navy-50">
            {tc("cancel")}
          </button>
          <button type="submit" disabled={busy} className="btn-accent">
            {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {tc("saving")}</> : t("submit")}
          </button>
        </div>
      </form>
    </div>
  );
}

function Input({
  label, value, onChange, type = "text", required,
}: { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-navy-700">{label}{required && " *"}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
      />
    </div>
  );
}
