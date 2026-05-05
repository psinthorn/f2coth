"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { Link, useRouter } from "@/i18n/routing";
import {
  ArrowLeft, Loader2, AlertTriangle, Plus, Ban, RotateCcw, Save, Ticket,
} from "lucide-react";
import AdminShell from "@/components/AdminShell";
import {
  adminApi,
  type AdminCustomer,
  type CustomerContactRow,
  type AdminDomain,
  type AdminSLA,
} from "@/lib/admin-api";

const priorities = ["low", "normal", "high", "urgent"] as const;
const slaStatuses = ["draft", "active", "renewing", "expired"] as const;

export default function AdminCustomerDetailPage() {
  const t = useTranslations("admin.customers.detail");
  const tc = useTranslations("common");
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;

  const [customer, setCustomer] = useState<AdminCustomer | null>(null);
  const [contacts, setContacts] = useState<CustomerContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [primaryEmail, setPrimaryEmail] = useState("");
  const [primaryPhone, setPrimaryPhone] = useState("");
  const [services, setServices] = useState("");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [cForm, setCForm] = useState({ email: "", full_name: "", role: "member" as "owner" | "member", password: "" });
  const [adding, setAdding] = useState(false);

  const [showTicket, setShowTicket] = useState(false);
  const [tForm, setTForm] = useState({
    subject: "",
    body: "",
    priority: "normal" as typeof priorities[number],
    related_service_slug: "",
    opened_by_contact_id: "",
    assign_to_self: true,
  });
  const [creatingTicket, setCreatingTicket] = useState(false);

  async function load() {
    if (!id) return;
    setLoading(true);
    try {
      const [c, list] = await Promise.all([
        adminApi.getCustomer(id),
        adminApi.listCustomerContacts(id),
      ]);
      setCustomer(c);
      setContacts(list.contacts ?? []);
      setName(c.name);
      setIndustry(c.industry ?? "");
      setPrimaryEmail(c.primary_contact_email ?? "");
      setPrimaryPhone(c.primary_contact_phone ?? "");
      setServices(c.services_used.join(", "));
      setNotes(c.notes ?? "");
      setIsActive(c.is_active);
    } catch (e: any) {
      setErr(tryMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  async function save() {
    if (!id) return;
    setSaving(true);
    setErr("");
    try {
      await adminApi.updateCustomer(id, {
        name,
        industry,
        primary_contact_email: primaryEmail,
        primary_contact_phone: primaryPhone,
        services_used: services.split(",").map((s) => s.trim()).filter(Boolean),
        notes,
        is_active: isActive,
      } as any);
      await load();
    } catch (e: any) {
      setErr(tryMsg(e));
    } finally {
      setSaving(false);
    }
  }

  async function addContact() {
    if (!id) return;
    setAdding(true);
    setErr("");
    try {
      await adminApi.createCustomerContact(id, cForm);
      setShowAdd(false);
      setCForm({ email: "", full_name: "", role: "member", password: "" });
      await load();
    } catch (e: any) {
      setErr(tryMsg(e));
    } finally {
      setAdding(false);
    }
  }

  async function createTicket() {
    if (!id) return;
    setCreatingTicket(true);
    setErr("");
    try {
      const res = await adminApi.createTicketForCustomer(id, {
        subject: tForm.subject.trim(),
        body: tForm.body.trim(),
        priority: tForm.priority,
        related_service_slug: tForm.related_service_slug || undefined,
        opened_by_contact_id: tForm.opened_by_contact_id || undefined,
        assign_to_self: tForm.assign_to_self,
      });
      router.push(`/admin/tickets/${res.id}` as any);
    } catch (e: any) {
      setErr(tryMsg(e));
      setCreatingTicket(false);
    }
  }

  async function disableContact(contactId: string) {
    if (!id) return;
    try { await adminApi.disableCustomerContact(id, contactId); await load(); } catch (e: any) { setErr(tryMsg(e)); }
  }
  async function enableContact(contactId: string) {
    if (!id) return;
    try { await adminApi.enableCustomerContact(id, contactId); await load(); } catch (e: any) { setErr(tryMsg(e)); }
  }

  return (
    <AdminShell>
      <Link href="/admin/customers" className="inline-flex items-center gap-1 text-sm text-navy-600 hover:text-accent-700">
        <ArrowLeft className="h-3.5 w-3.5" /> {t("back")}
      </Link>

      {loading ? (
        <div className="mt-6 flex items-center gap-2 text-navy-500"><Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}</div>
      ) : !customer ? (
        <div className="mt-6 card text-navy-500">{tc("notFound")}</div>
      ) : (
        <>
          <header className="mt-4 mb-6 flex items-start justify-between gap-4">
            <div>
              <h1 className="font-display text-3xl text-navy-900">{customer.name}</h1>
              <p className="mt-1 text-sm text-navy-500">slug: {customer.slug}</p>
            </div>
            <button onClick={() => setShowTicket((v) => !v)} className="btn-accent shrink-0">
              <Ticket className="h-4 w-4" /> {t("openTicketOnBehalf")}
            </button>
          </header>

          {showTicket && (
            <div className="card mb-6 border-accent-200 bg-accent-50/40">
              <h2 className="font-semibold text-navy-900">{t("openTicketTitle", { customer: customer.name })}</h2>
              <p className="mt-1 text-xs text-navy-600">{t("openTicketBlurb")}</p>

              <div className="mt-4 grid gap-3">
                <Field label={t("subject")} value={tForm.subject} onChange={(v) => setTForm({ ...tForm, subject: v })} placeholder={t("subjectPlaceholder")} />

                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-navy-800">{t("description")}</label>
                  <textarea
                    value={tForm.body}
                    onChange={(e) => setTForm({ ...tForm, body: e.target.value })}
                    rows={5} maxLength={10000}
                    placeholder={t("descriptionPlaceholder")}
                    className="rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-navy-800">{t("priority")}</label>
                    <select
                      value={tForm.priority}
                      onChange={(e) => setTForm({ ...tForm, priority: e.target.value as typeof priorities[number] })}
                      className="rounded-lg border border-navy-200 px-3 py-2 text-sm"
                    >
                      {priorities.map((p) => <option key={p} value={p}>{tc(`priority.${p}`)}</option>)}
                    </select>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-navy-800">{t("relatedService")}</label>
                    <select
                      value={tForm.related_service_slug}
                      onChange={(e) => setTForm({ ...tForm, related_service_slug: e.target.value })}
                      className="rounded-lg border border-navy-200 px-3 py-2 text-sm"
                    >
                      <option value="">{t("noneOption")}</option>
                      {customer.services_used.map((s) => (
                        <option key={s} value={s}>{s.replace(/-/g, " ")}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-navy-800">{t("onBehalfOf")}</label>
                    <select
                      value={tForm.opened_by_contact_id}
                      onChange={(e) => setTForm({ ...tForm, opened_by_contact_id: e.target.value })}
                      className="rounded-lg border border-navy-200 px-3 py-2 text-sm"
                    >
                      <option value="">{t("f2Initiated")}</option>
                      {contacts.filter((c) => !c.disabled_at).map((c) => (
                        <option key={c.id} value={c.id}>{c.full_name} ({c.email})</option>
                      ))}
                    </select>
                  </div>
                </div>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={tForm.assign_to_self}
                    onChange={(e) => setTForm({ ...tForm, assign_to_self: e.target.checked })}
                  />
                  {t("assignToMe")}
                </label>
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <button onClick={() => setShowTicket(false)} className="btn-ghost">{tc("cancel")}</button>
                <button
                  onClick={createTicket}
                  disabled={creatingTicket || !tForm.subject.trim() || !tForm.body.trim()}
                  className="btn-accent"
                >
                  {creatingTicket
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("openingTicket")}</>
                    : <><Ticket className="h-4 w-4" /> {t("openTicket")}</>}
                </button>
              </div>
            </div>
          )}

          {err && (
            <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
              <AlertTriangle className="mt-0.5 h-4 w-4" /><span>{err}</span>
            </div>
          )}

          {id && customer.services_used.includes("domain-hosting") && (
            <DomainsPanel customerId={id} />
          )}
          <SLAPanel customerId={id!} services={customer.services_used} />

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="card">
              <h2 className="font-semibold text-navy-900">{t("profile")}</h2>
              <div className="mt-4 grid gap-3">
                <Field label={tc("edit")} value={name} onChange={setName} />
                <Field label={t("primaryEmail")} value={primaryEmail} onChange={setPrimaryEmail} />
                <Field label={t("primaryPhone")} value={primaryPhone} onChange={setPrimaryPhone} />
                <Field label={t("servicesField")} value={services} onChange={setServices} placeholder={t("servicesPlaceholder")} />
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-navy-800">{t("notes")}</label>
                  <textarea
                    value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
                    className="rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                  {t("active")}
                </label>
                <button onClick={save} disabled={saving} className="btn-accent self-start">
                  {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> {tc("saving")}</> : <><Save className="h-4 w-4" /> {t("saveChanges")}</>}
                </button>
              </div>
            </section>

            <section className="card">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-navy-900">{t("contacts")}</h2>
                <button onClick={() => setShowAdd((v) => !v)} className="btn-accent text-xs">
                  <Plus className="h-3.5 w-3.5" /> {t("addContact")}
                </button>
              </div>

              {showAdd && (
                <div className="mt-4 rounded-lg border border-navy-100 bg-navy-50 p-4">
                  <div className="grid gap-3">
                    <Field label={t("fullNameField")} value={cForm.full_name} onChange={(v) => setCForm({ ...cForm, full_name: v })} />
                    <Field label={t("emailField")} value={cForm.email} onChange={(v) => setCForm({ ...cForm, email: v })} type="email" />
                    <Field label={t("passwordField")} value={cForm.password} onChange={(v) => setCForm({ ...cForm, password: v })} type="password" />
                    <div className="flex flex-col gap-1">
                      <label className="text-sm font-medium text-navy-800">{t("roleField")}</label>
                      <select
                        value={cForm.role}
                        onChange={(e) => setCForm({ ...cForm, role: e.target.value as "owner" | "member" })}
                        className="rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
                      >
                        <option value="owner">{tc("role.owner")}</option>
                        <option value="member">{tc("role.member")}</option>
                      </select>
                    </div>
                  </div>
                  <div className="mt-3 flex justify-end gap-2">
                    <button onClick={() => setShowAdd(false)} className="btn-ghost text-xs">{tc("cancel")}</button>
                    <button onClick={addContact} disabled={adding} className="btn-accent text-xs">
                      {adding ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {tc("creating")}</> : tc("add")}
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-4 divide-y divide-navy-100">
                {contacts.length === 0 ? (
                  <p className="text-sm text-navy-500 py-2">{t("noContacts")}</p>
                ) : (
                  contacts.map((c) => (
                    <div key={c.id} className={`py-3 ${c.disabled_at ? "opacity-50" : ""}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-navy-900 truncate">{c.full_name}</p>
                          <p className="text-xs text-navy-500 truncate">{c.email} · {tc(`role.${c.role}`)}</p>
                        </div>
                        <div className="shrink-0">
                          {c.disabled_at ? (
                            <button onClick={() => enableContact(c.id)}
                              className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-100">
                              <RotateCcw className="h-3 w-3" /> {t("enable")}
                            </button>
                          ) : (
                            <button onClick={() => disableContact(c.id)}
                              className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100">
                              <Ban className="h-3 w-3" /> {t("disable")}
                            </button>
                          )}
                        </div>
                      </div>
                      {c.last_login_at && <p className="text-xs text-navy-400 mt-1">{t("lastLogin", { date: new Date(c.last_login_at).toLocaleString() })}</p>}
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </>
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

// ----------------------------- Domains panel -----------------------------

function DomainsPanel({ customerId }: { customerId: string }) {
  const t = useTranslations("admin.customers.detail.domains");
  const tc = useTranslations("common");
  const [rows, setRows] = useState<AdminDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    domain: "", registrar: "ResellerClub",
    expires_at: "", privacy_enabled: true, auto_renew: true, notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    setLoading(true);
    try { setRows((await adminApi.listCustomerDomains(customerId)).domains ?? []); }
    catch (e: any) { setErr(tryMsg(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [customerId]);

  async function add() {
    setBusy(true); setErr("");
    try {
      await adminApi.createCustomerDomain(customerId, {
        ...form,
        expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
      } as any);
      setShowAdd(false);
      setForm({ domain: "", registrar: "ResellerClub", expires_at: "", privacy_enabled: true, auto_renew: true, notes: "" });
      await load();
    } catch (e: any) { setErr(tryMsg(e)); }
    finally { setBusy(false); }
  }

  async function togglePrivacy(d: AdminDomain) {
    setErr("");
    try { await adminApi.updateCustomerDomain(customerId, d.id, { privacy_enabled: !d.privacy_enabled }); await load(); }
    catch (e: any) { setErr(tryMsg(e)); }
  }
  async function del(d: AdminDomain) {
    if (!confirm(t("removeConfirm", { domain: d.domain }))) return;
    try { await adminApi.deleteCustomerDomain(customerId, d.id); await load(); }
    catch (e: any) { setErr(tryMsg(e)); }
  }

  return (
    <section className="card mb-6">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-navy-900">{t("title")}</h2>
        <button onClick={() => setShowAdd((v) => !v)} className="btn-accent text-xs">
          <Plus className="h-3.5 w-3.5" /> {t("addButton")}
        </button>
      </div>
      {err && <p className="mt-2 text-sm text-red-700">{err}</p>}

      {showAdd && (
        <div className="mt-4 grid gap-3 rounded-lg border border-navy-100 bg-navy-50 p-4 sm:grid-cols-2">
          <Field label={t("domain")} value={form.domain} onChange={(v) => setForm({ ...form, domain: v })} placeholder={t("domainPlaceholder")} />
          <Field label={t("registrar")} value={form.registrar} onChange={(v) => setForm({ ...form, registrar: v })} />
          <Field label={t("expiresAt")} value={form.expires_at} onChange={(v) => setForm({ ...form, expires_at: v })} type="date" />
          <Field label={t("notes")} value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.privacy_enabled} onChange={(e) => setForm({ ...form, privacy_enabled: e.target.checked })} />
            {t("privacyEnabled")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.auto_renew} onChange={(e) => setForm({ ...form, auto_renew: e.target.checked })} />
            {t("autoRenew")}
          </label>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <button onClick={() => setShowAdd(false)} className="btn-ghost text-xs">{tc("cancel")}</button>
            <button onClick={add} disabled={busy || !form.domain} className="btn-accent text-xs">
              {busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {tc("creating")}</> : tc("add")}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="mt-3 flex items-center gap-2 text-navy-500"><Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}</div>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-navy-500">{t("noneYet")} <strong>{t("addDomainText")}</strong>.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-navy-500">
              <tr>
                <th className="py-2">{t("table.domain")}</th>
                <th className="py-2">{t("table.registrar")}</th>
                <th className="py-2">{t("table.expires")}</th>
                <th className="py-2">{t("table.privacy")}</th>
                <th className="py-2">{t("table.autoRenew")}</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {rows.map((d) => (
                <tr key={d.id}>
                  <td className="py-2 font-medium text-navy-900">{d.domain}</td>
                  <td className="py-2 text-navy-700">{d.registrar}</td>
                  <td className="py-2 text-navy-700 text-xs">{d.expires_at ? new Date(d.expires_at).toLocaleDateString() : "—"}</td>
                  <td className="py-2">
                    <button onClick={() => togglePrivacy(d)} className="text-xs text-accent-700 hover:text-accent-900">
                      {d.privacy_enabled ? t("privacyOn") : t("privacyOff")}
                    </button>
                  </td>
                  <td className="py-2 text-navy-700 text-xs">{d.auto_renew ? t("yes") : t("no")}</td>
                  <td className="py-2 text-right">
                    <button onClick={() => del(d)} className="text-xs text-red-700 hover:text-red-900">{tc("remove")}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ----------------------------- SLA panel -----------------------------

function SLAPanel({ customerId, services }: { customerId: string; services: string[] }) {
  const t = useTranslations("admin.customers.detail.sla");
  const tc = useTranslations("common");
  const [rows, setRows] = useState<AdminSLA[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    service_slug: services[0] ?? "",
    title: "",
    starts_on: "",
    ends_on: "",
    target_uptime_pct: 99.9,
    status: "active" as typeof slaStatuses[number],
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    setLoading(true);
    try { setRows((await adminApi.listCustomerSLA(customerId)).sla_contracts ?? []); }
    catch (e: any) { setErr(tryMsg(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [customerId]);

  async function add() {
    setBusy(true); setErr("");
    try {
      await adminApi.createCustomerSLA(customerId, form);
      setShowAdd(false);
      setForm({ ...form, title: "", starts_on: "", ends_on: "", notes: "" });
      await load();
    } catch (e: any) { setErr(tryMsg(e)); }
    finally { setBusy(false); }
  }
  async function setStatus(s: AdminSLA, status: typeof slaStatuses[number]) {
    try { await adminApi.updateCustomerSLA(customerId, s.id, { status }); await load(); }
    catch (e: any) { setErr(tryMsg(e)); }
  }
  async function del(s: AdminSLA) {
    if (!confirm(t("removeConfirm", { title: s.title }))) return;
    try { await adminApi.deleteCustomerSLA(customerId, s.id); await load(); }
    catch (e: any) { setErr(tryMsg(e)); }
  }

  return (
    <section className="card mb-6">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-navy-900">{t("title")}</h2>
        <button onClick={() => setShowAdd((v) => !v)} className="btn-accent text-xs">
          <Plus className="h-3.5 w-3.5" /> {t("addButton")}
        </button>
      </div>
      {err && <p className="mt-2 text-sm text-red-700">{err}</p>}

      {showAdd && (
        <div className="mt-4 grid gap-3 rounded-lg border border-navy-100 bg-navy-50 p-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-navy-800">{t("service")}</label>
            <select value={form.service_slug} onChange={(e) => setForm({ ...form, service_slug: e.target.value })}
              className="rounded-lg border border-navy-200 px-3 py-2 text-sm">
              {services.map((s) => <option key={s} value={s}>{s}</option>)}
              {services.length === 0 && <option value="">{t("noneContracted")}</option>}
            </select>
          </div>
          <Field label={t("titleField")} value={form.title} onChange={(v) => setForm({ ...form, title: v })} placeholder={t("titlePlaceholder")} />
          <Field label={t("startsOn")} value={form.starts_on} onChange={(v) => setForm({ ...form, starts_on: v })} type="date" />
          <Field label={t("endsOn")} value={form.ends_on} onChange={(v) => setForm({ ...form, ends_on: v })} type="date" />
          <Field label={t("targetUptime")} value={String(form.target_uptime_pct)} onChange={(v) => setForm({ ...form, target_uptime_pct: parseFloat(v) || 0 })} type="number" />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-navy-800">{t("status")}</label>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as typeof slaStatuses[number] })}
              className="rounded-lg border border-navy-200 px-3 py-2 text-sm">
              {slaStatuses.map((s) => <option key={s} value={s}>{tc(`slaStatus.${s}`)}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2 flex flex-col gap-1">
            <label className="text-sm font-medium text-navy-800">{t("notes")}</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2}
              className="rounded-lg border border-navy-200 px-3 py-2 text-sm" />
          </div>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <button onClick={() => setShowAdd(false)} className="btn-ghost text-xs">{tc("cancel")}</button>
            <button onClick={add} disabled={busy || !form.title || !form.starts_on || !form.ends_on || !form.service_slug}
              className="btn-accent text-xs">
              {busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {tc("creating")}</> : tc("add")}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="mt-3 flex items-center gap-2 text-navy-500"><Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}</div>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-navy-500">{t("noneYet")}</p>
      ) : (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {rows.map((s) => (
            <div key={s.id} className="rounded-lg border border-navy-100 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-wider text-navy-500">{s.service_slug}</p>
                  <p className="mt-0.5 font-medium text-navy-900">{s.title}</p>
                  <p className="mt-1 text-xs text-navy-600">{s.starts_on} → {s.ends_on} · {t("target", { pct: s.target_uptime_pct })}</p>
                </div>
                <select value={s.status} onChange={(e) => setStatus(s, e.target.value as typeof slaStatuses[number])}
                  className="rounded border border-navy-200 px-2 py-1 text-xs">
                  {slaStatuses.map((v) => <option key={v} value={v}>{tc(`slaStatus.${v}`)}</option>)}
                </select>
              </div>
              {s.notes && <p className="mt-2 text-xs text-navy-700">{s.notes}</p>}
              <button onClick={() => del(s)} className="mt-2 text-xs text-red-700 hover:text-red-900">{tc("remove")}</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
