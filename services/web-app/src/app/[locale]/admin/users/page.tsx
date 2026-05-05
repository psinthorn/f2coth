"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, UserPlus, Ban, RotateCcw, AlertTriangle } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { adminApi, type User, type Role } from "@/lib/admin-api";

const roles: Role[] = ["admin", "editor", "viewer"];

export default function AdminUsersPage() {
  const t = useTranslations("admin.users");
  const tc = useTranslations("common");
  const [users, setUsers] = useState<User[]>([]);
  const [me, setMe] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ email: "", full_name: "", role: "editor" as Role, password: "" });
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [u, m] = await Promise.all([adminApi.listUsers(), adminApi.me()]);
      setUsers(u.users ?? []);
      setMe(m);
    } catch (e: any) {
      setErr(e?.message ?? "load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function create() {
    setErr("");
    setCreating(true);
    try {
      await adminApi.createUser(form);
      setShowCreate(false);
      setForm({ email: "", full_name: "", role: "editor", password: "" });
      await load();
    } catch (e: any) {
      const msg = e?.body ? tryParse(e.body) : e?.message ?? "create failed";
      setErr(msg);
    } finally {
      setCreating(false);
    }
  }

  async function changeRole(u: User, role: Role) {
    setErr("");
    try {
      await adminApi.updateUser(u.id, { role });
      await load();
    } catch (e: any) {
      setErr(tryParse(e?.body ?? "") || e?.message || "update failed");
    }
  }

  async function disable(u: User) {
    setErr("");
    try {
      await adminApi.disableUser(u.id);
      await load();
    } catch (e: any) {
      setErr(tryParse(e?.body ?? "") || e?.message || "disable failed");
    }
  }

  async function enable(u: User) {
    setErr("");
    try {
      await adminApi.enableUser(u.id);
      await load();
    } catch (e: any) {
      setErr(tryParse(e?.body ?? "") || e?.message || "enable failed");
    }
  }

  return (
    <AdminShell>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
          <p className="mt-1 text-sm text-navy-600">{t("subtitle", { count: users.length })}</p>
        </div>
        <button onClick={() => setShowCreate((v) => !v)} className="btn-accent">
          <UserPlus className="h-4 w-4" /> {t("addButton")}
        </button>
      </header>

      {err && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4" /><span>{err}</span>
        </div>
      )}

      {showCreate && (
        <div className="card mb-6">
          <h3 className="font-semibold text-navy-900">{t("newUser")}</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label={t("fullName")} value={form.full_name} onChange={(v) => setForm({ ...form, full_name: v })} />
            <Field label={t("email")} type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
            <Field label={t("passwordHint")} type="password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} />
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-navy-800">{t("role")}</label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
                className="rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
              >
                {roles.map((r) => <option key={r} value={r}>{tc(`role.${r}`)}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setShowCreate(false)} className="btn-ghost">{tc("cancel")}</button>
            <button onClick={create} disabled={creating} className="btn-accent">
              {creating ? <><Loader2 className="h-4 w-4 animate-spin" /> {tc("creating")}</> : tc("create")}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-navy-500"><Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}</div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-navy-50 text-left text-xs uppercase tracking-wider text-navy-500">
              <tr>
                <th className="px-4 py-3 font-semibold">{t("table.name")}</th>
                <th className="px-4 py-3 font-semibold">{t("table.email")}</th>
                <th className="px-4 py-3 font-semibold">{t("table.role")}</th>
                <th className="px-4 py-3 font-semibold">{t("table.status")}</th>
                <th className="px-4 py-3 font-semibold">{t("table.lastLogin")}</th>
                <th className="px-4 py-3 font-semibold text-right">{t("table.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {users.map((u) => {
                const isMe = me?.id === u.id;
                return (
                  <tr key={u.id} className={u.is_active ? "" : "opacity-60"}>
                    <td className="px-4 py-3 font-medium text-navy-900">
                      {u.full_name}{isMe && <span className="ml-2 text-xs text-accent-700">{t("you")}</span>}
                    </td>
                    <td className="px-4 py-3 text-navy-600">{u.email}</td>
                    <td className="px-4 py-3">
                      <select
                        value={u.role}
                        disabled={isMe || !u.is_active}
                        onChange={(e) => changeRole(u, e.target.value as Role)}
                        className="rounded border border-navy-200 px-2 py-1 text-xs disabled:opacity-50"
                      >
                        {roles.map((r) => <option key={r} value={r}>{tc(`role.${r}`)}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      {u.is_active ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">{t("table.active")}</span>
                      ) : (
                        <span className="rounded-full bg-navy-100 px-2 py-0.5 text-xs text-navy-700">{t("table.disabled")}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-navy-500 text-xs">
                      {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : t("table.never")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {u.is_active ? (
                        <button
                          onClick={() => disable(u)}
                          disabled={isMe}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100 disabled:opacity-50"
                        >
                          <Ban className="h-3.5 w-3.5" /> {t("disable")}
                        </button>
                      ) : (
                        <button
                          onClick={() => enable(u)}
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-100"
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> {t("enable")}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}

function Field({ label, value, onChange, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; type?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-navy-800">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
      />
    </div>
  );
}

function tryParse(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: string };
    return j.error ?? body;
  } catch {
    return body;
  }
}
