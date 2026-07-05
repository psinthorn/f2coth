"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Loader2, Plus, ClipboardCheck } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { checklistApi, type Project } from "@/lib/checklist-api";
import { adminApi, type AdminCustomer } from "@/lib/admin-api";

export default function AdminProjectsPage() {
  const t = useTranslations("admin.projects");
  const tc = useTranslations("common");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    checklistApi.listProjects()
      .then((d) => setProjects(d.projects ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <AdminShell>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
          <p className="mt-1 text-sm text-navy-600">{t("subtitle")}</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600"
        >
          <Plus className="h-4 w-4" /> {t("newProject")}
        </button>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-navy-500">
          <Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}
        </div>
      ) : projects.length === 0 ? (
        <div className="card text-center text-navy-500">
          <ClipboardCheck className="mx-auto mb-3 h-8 w-8 text-navy-300" />
          <p>{t("noneYet")}</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard key={p.id} p={p} />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateProjectDialog
          onClose={() => setShowCreate(false)}
          onCreated={(p) => {
            setProjects((prev) => [p, ...prev]);
            setShowCreate(false);
          }}
        />
      )}
    </AdminShell>
  );
}

function ProjectCard({ p }: { p: Project }) {
  const t = useTranslations("admin.projects");
  const done = p.done_count ?? 0;
  const total = p.total_count ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <Link href={`/admin/projects/${p.id}` as any} className="card block hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-navy-500">
            {p.customer_name ?? p.client_name}
            {p.customer_id && <span className="ml-1 text-accent-600">·</span>}
          </p>
          <h3 className="mt-0.5 font-medium text-navy-900 truncate">{p.name}</h3>
          {!p.visible_to_customer && (
            <p className="mt-0.5 text-[10px] uppercase tracking-wider text-amber-700">{t("hiddenFromCustomer")}</p>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
            p.status === "active" ? "bg-emerald-50 text-emerald-800"
              : p.status === "paused" ? "bg-amber-50 text-amber-800"
                : "bg-navy-100 text-navy-700"
          }`}
        >
          {t(`status.${p.status}`)}
        </span>
      </div>
      <div className="mt-4">
        <div className="flex justify-between text-xs text-navy-600">
          <span>{t("progress")}</span>
          <span>{done} / {total}</span>
        </div>
        <div className="mt-1 h-2 rounded-full bg-navy-100 overflow-hidden">
          <div
            className={`h-full ${p.fail_count && p.fail_count > 0 ? "bg-amber-500" : "bg-accent-500"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {p.fail_count && p.fail_count > 0 ? (
          <p className="mt-2 text-xs text-red-700">{t("failCount", { count: p.fail_count })}</p>
        ) : null}
      </div>
    </Link>
  );
}

function CreateProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (p: Project) => void }) {
  const t = useTranslations("admin.projects");
  const [customers, setCustomers] = useState<AdminCustomer[]>([]);
  const [customerId, setCustomerId] = useState<string>("");
  const [clientName, setClientName] = useState("");
  const [name, setName] = useState("");
  const [visibleToCustomer, setVisibleToCustomer] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi.listCustomers().then((d) => setCustomers(d.customers ?? [])).catch(() => {});
  }, []);

  // Picking a customer auto-fills client_name so the display fallback
  // still works if the customer link is later cleared.
  function pickCustomer(id: string) {
    setCustomerId(id);
    if (id) {
      const c = customers.find((x) => x.id === id);
      if (c && !clientName) setClientName(c.name);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const p = await checklistApi.createProject({
        client_name: clientName,
        name,
        customer_id: customerId || null,
        visible_to_customer: visibleToCustomer,
      });
      onCreated(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-navy-900/40 p-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
        <h2 className="font-display text-xl text-navy-900">{t("newProject")}</h2>
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-sm text-navy-700">{t("form.customer")}</span>
            <select
              value={customerId}
              onChange={(e) => pickCustomer(e.target.value)}
              className="mt-1 w-full rounded-lg border border-navy-200 px-3 py-2 text-sm"
            >
              <option value="">{t("form.customerNone")}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-navy-500">{t("form.customerHint")}</span>
          </label>
          <label className="block">
            <span className="text-sm text-navy-700">{t("form.clientName")}</span>
            <input
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-navy-200 px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-sm text-navy-700">{t("form.name")}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-navy-200 px-3 py-2 text-sm"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-navy-700">
            <input
              type="checkbox"
              checked={visibleToCustomer}
              onChange={(e) => setVisibleToCustomer(e.target.checked)}
              className="h-4 w-4 rounded border-navy-300"
            />
            {t("form.visibleToCustomer")}
          </label>
          {error && <p className="text-sm text-red-700">{error}</p>}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-navy-700 hover:bg-navy-50">
            {t("form.cancel")}
          </button>
          <button type="submit" disabled={saving} className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("form.create")}
          </button>
        </div>
      </form>
    </div>
  );
}
