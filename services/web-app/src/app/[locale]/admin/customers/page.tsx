"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Loader2, Plus, AlertTriangle, ShieldCheck } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { toast } from "@/lib/toast";
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
      toast.success(tc("toast.added"));
      setShowAdd(false);
      setForm({ slug: "", name: "", industry: "", primary_contact_email: "" });
      await load();
    } catch (e: any) {
      setErr(tryMsg(e));
      toast.error(tryMsg(e));
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

      <PortalVerificationToggle />
      <MFAPolicyPanel />

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
            <button onClick={add} disabled={adding || !form.slug || !form.name} className="btn-accent disabled:opacity-40">
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

// Global toggle: when ON, unverified portal users can still log in but are
// blocked from sensitive actions (open ticket / reply) until they verify.
function PortalVerificationToggle() {
  const t = useTranslations("admin.customers.verification");
  const [on, setOn] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    adminApi.getPortalSettings()
      .then((s) => setOn(s.require_email_verification))
      .catch(() => setOn(false));
  }, []);

  async function toggle() {
    if (on === null || saving) return;
    setSaving(true);
    const next = !on;
    try {
      await adminApi.updatePortalSettings({ require_email_verification: next });
      setOn(next);
      toast.success(next ? t("enabled") : t("disabled"));
    } catch {
      toast.error(t("error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-6 flex items-center justify-between gap-4 rounded-lg border border-navy-100 bg-navy-50 p-4">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 text-navy-500" />
        <div>
          <p className="text-sm font-medium text-navy-900">{t("title")}</p>
          <p className="text-xs text-navy-500">{t("hint")}</p>
        </div>
      </div>
      <button
        onClick={toggle}
        disabled={on === null || saving}
        role="switch"
        aria-checked={on === true}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${on ? "bg-accent-500" : "bg-navy-200"}`}
      >
        <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`} />
      </button>
    </div>
  );
}

const MFA_ORG_ROLES = ["owner", "admin", "billing", "member", "viewer"] as const;

function MFAPolicyPanel() {
  const t = useTranslations("admin.customers.mfaPolicy");
  const tc = useTranslations("common");
  const [staff, setStaff] = useState<boolean | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    adminApi.getPortalSettings()
      .then((s) => { setStaff(s.require_mfa_staff); setRoles(s.require_mfa_customer_roles ?? []); })
      .catch(() => setStaff(false));
  }, []);

  async function save(next: { require_mfa_staff?: boolean; require_mfa_customer_roles?: string[] }) {
    if (saving) return;
    setSaving(true);
    try {
      await adminApi.updatePortalSettings(next);
      if (next.require_mfa_staff !== undefined) setStaff(next.require_mfa_staff);
      if (next.require_mfa_customer_roles) setRoles(next.require_mfa_customer_roles);
      toast.success(tc("toast.saved"));
    } catch {
      toast.error(tc("toast.error"));
    } finally {
      setSaving(false);
    }
  }
  const toggleRole = (r: string) => {
    const next = roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r];
    save({ require_mfa_customer_roles: next });
  };

  if (staff === null) return null;
  return (
    <div className="mb-6 rounded-lg border border-navy-100 bg-navy-50 p-4">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 text-navy-500" />
        <div className="flex-1">
          <p className="text-sm font-medium text-navy-900">{t("title")}</p>
          <p className="text-xs text-navy-500">{t("hint")}</p>

          <label className="mt-3 flex items-center gap-2 text-sm text-navy-800">
            <input type="checkbox" checked={staff} disabled={saving} onChange={(e) => save({ require_mfa_staff: e.target.checked })} className="rounded border-navy-300" />
            {t("staff")}
          </label>

          <p className="mt-3 text-xs font-medium uppercase tracking-wider text-navy-400">{t("customerRoles")}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {MFA_ORG_ROLES.map((r) => {
              const active = roles.includes(r);
              return (
                <button key={r} onClick={() => toggleRole(r)} disabled={saving}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition disabled:opacity-50 ${active ? "border-accent-300 bg-accent-50 text-accent-800" : "border-navy-200 bg-white text-navy-600 hover:bg-navy-50"}`}>
                  {tc(`role.${r}`)}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
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
