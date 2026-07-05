"use client";

// /admin/tickets/new — F2 staff creates a ticket on behalf of a customer.
// Real-world flow (per F2 pilot feedback): customers frequently phone or
// email a request instead of opening a portal ticket themselves, so the
// admin needs a one-page form that lands the request in the same queue
// without navigating through the customer list first.
//
// Backend endpoint (POST /customer/admin/customers/:id/tickets) already
// exists — this page is the missing UI. Same endpoint powers the
// "Open ticket on behalf" button on /admin/customers/[id]; both call
// adminApi.createTicketForCustomer.

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import {
  ArrowLeft, Loader2, AlertTriangle, Ticket, Search, Paperclip, CheckCircle2,
} from "lucide-react";
import AdminShell from "@/components/AdminShell";
import AttachmentUploader from "@/components/attachments/AttachmentUploader";
import { adminAttachments } from "@/lib/attachments-api";
import {
  adminApi,
  type AdminCustomer,
  type CustomerContactRow,
} from "@/lib/admin-api";

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
type Priority = typeof PRIORITIES[number];

export default function AdminNewTicketPage() {
  const t = useTranslations("admin.tickets.new");
  const tc = useTranslations("common");
  const ta = useTranslations("attachments");
  const router = useRouter();

  // createdTicketID != null → step 2 (attach files); null → step 1 (form).
  // Mirrors the two-step flow on /portal/tickets/new so uploads land on
  // the real ticket id instead of a client-side placeholder.
  const [createdTicketID, setCreatedTicketID] = useState<string | null>(null);

  const [customers, setCustomers] = useState<AdminCustomer[]>([]);
  const [customersLoading, setCustomersLoading] = useState(true);
  const [customerFilter, setCustomerFilter] = useState("");
  const [customerID, setCustomerID] = useState("");

  const [contacts, setContacts] = useState<CustomerContactRow[]>([]);
  const [contactID, setContactID] = useState("");

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const [relatedService, setRelatedService] = useState("");
  const [assignToSelf, setAssignToSelf] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    adminApi.listCustomers()
      .then((d) => setCustomers((d.customers ?? []).filter((c) => c.is_active)))
      .catch((e: unknown) => setErr(tryMsg(e)))
      .finally(() => setCustomersLoading(false));
  }, []);

  // When the picked customer changes, reload their contact list and
  // wipe any stale contact/service selection so the dropdowns can't
  // reference IDs that don't belong to the new customer.
  useEffect(() => {
    setContactID("");
    setRelatedService("");
    if (!customerID) {
      setContacts([]);
      return;
    }
    adminApi.listCustomerContacts(customerID)
      .then((d) => setContacts((d.contacts ?? []).filter((c) => !c.disabled_at)))
      .catch(() => setContacts([]));
  }, [customerID]);

  const filtered = useMemo(() => {
    if (!customerFilter.trim()) return customers;
    const q = customerFilter.trim().toLowerCase();
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.slug.toLowerCase().includes(q) ||
        (c.industry ?? "").toLowerCase().includes(q),
    );
  }, [customers, customerFilter]);

  const selected = customers.find((c) => c.id === customerID) ?? null;

  async function submit() {
    if (!customerID || !subject.trim() || !body.trim()) return;
    setSubmitting(true);
    setErr("");
    try {
      const res = await adminApi.createTicketForCustomer(customerID, {
        subject: subject.trim(),
        body: body.trim(),
        priority,
        related_service_slug: relatedService || undefined,
        opened_by_contact_id: contactID || undefined,
        assign_to_self: assignToSelf,
      });
      // Enter the attach step. AttachmentUploader needs the real ticket
      // id to POST files to. The "View ticket" button ends the flow.
      setCreatedTicketID(res.id);
      setSubmitting(false);
    } catch (e: unknown) {
      setErr(tryMsg(e));
      setSubmitting(false);
    }
  }

  const canSubmit = !!customerID && subject.trim().length > 0 && body.trim().length > 0 && !submitting;

  return (
    <AdminShell>
      <Link
        href={"/admin/tickets" as never}
        className="inline-flex items-center gap-1 text-sm text-navy-600 hover:text-accent-700"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> {t("back")}
      </Link>

      <header className="mt-4 mb-6">
        <div className="flex items-center gap-2">
          <Ticket className="h-6 w-6 text-accent-700" />
          <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
        </div>
        <p className="mt-1 text-sm text-navy-600">{t("subtitle")}</p>
      </header>

      {err && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4" /> <span>{err}</span>
        </div>
      )}

      {createdTicketID ? (
        // ── Step 2 — attach files to the freshly-created ticket ───────
        // Runs the same AttachmentUploader used by portal + admin ticket
        // detail. It supports multiple documents, multiple images, and
        // "Take photo" (device camera + GPS coords via navigator.geolocation)
        // — nothing custom needed here, just pass the ticket owner id +
        // the admin-scoped attachments client.
        <div className="card max-w-3xl space-y-4">
          <div className="flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
            <CheckCircle2 className="mt-0.5 h-4 w-4" />
            <span>{t("attach.created")}</span>
          </div>
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-navy-800">
              <Paperclip className="h-4 w-4" /> {ta("title")}
            </div>
            <p className="mb-3 text-xs text-navy-500">{t("attach.hint")}</p>
            <AttachmentUploader
              ownerType="ticket"
              ownerId={createdTicketID}
              client={adminAttachments}
            />
          </div>
          <div className="flex justify-end gap-2 border-t border-navy-100 pt-4">
            <button
              type="button"
              onClick={() => router.push(`/admin/tickets/${createdTicketID}` as never)}
              className="btn-accent"
            >
              {t("attach.viewTicket")}
            </button>
          </div>
        </div>
      ) : (
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column: customer picker */}
        <div className="lg:col-span-1 space-y-4">
          <section className="card">
            <h2 className="text-sm font-semibold text-navy-900 uppercase tracking-wider">
              {t("customerPicker.title")}
            </h2>
            {customersLoading ? (
              <p className="mt-3 text-sm text-navy-500">
                <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> {tc("loading")}
              </p>
            ) : (
              <>
                <div className="mt-3 relative">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-navy-400" />
                  <input
                    type="text"
                    value={customerFilter}
                    onChange={(e) => setCustomerFilter(e.target.value)}
                    placeholder={t("customerPicker.searchPlaceholder")}
                    className="w-full rounded-lg border border-navy-200 py-2 pl-8 pr-3 text-sm focus:border-accent-500 focus:outline-none"
                  />
                </div>

                <ul className="mt-3 max-h-96 overflow-y-auto divide-y divide-navy-100">
                  {filtered.length === 0 ? (
                    <li className="py-3 text-sm text-navy-500">{t("customerPicker.noMatch")}</li>
                  ) : (
                    filtered.map((c) => {
                      const active = c.id === customerID;
                      return (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => setCustomerID(c.id)}
                            className={`w-full text-left px-3 py-2 rounded-lg transition ${
                              active ? "bg-accent-50 text-accent-800" : "hover:bg-navy-50"
                            }`}
                          >
                            <p className="font-medium text-navy-900 text-sm">{c.name}</p>
                            <p className="text-xs text-navy-500 truncate">
                              {c.slug}
                              {c.industry ? ` · ${c.industry}` : ""}
                            </p>
                          </button>
                        </li>
                      );
                    })
                  )}
                </ul>
              </>
            )}
          </section>
        </div>

        {/* Right column: ticket form (disabled until a customer is picked) */}
        <div className="lg:col-span-2 space-y-4">
          <section className={`card ${!customerID ? "opacity-60" : ""}`}>
            {!customerID ? (
              <p className="text-sm text-navy-500 italic">{t("form.pickCustomerFirst")}</p>
            ) : (
              <>
                {selected && (
                  <p className="text-xs text-navy-500 uppercase tracking-wider mb-4">
                    {t("form.forCustomer")}:{" "}
                    <span className="font-medium text-navy-900 normal-case">{selected.name}</span>
                  </p>
                )}

                <div className="space-y-4">
                  <TextField
                    label={t("form.subject") + " *"}
                    value={subject}
                    onChange={setSubject}
                    maxLength={200}
                    placeholder={t("form.subjectPlaceholder")}
                  />

                  <div>
                    <label className="block text-xs font-medium text-navy-800 mb-1">
                      {t("form.description")} *
                    </label>
                    <textarea
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      rows={8}
                      maxLength={10000}
                      placeholder={t("form.descriptionPlaceholder")}
                      className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
                    />
                    <p className="mt-1 text-[11px] text-navy-500">
                      {t("form.descriptionHint")}
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <label className="block text-xs font-medium text-navy-800 mb-1">
                        {t("form.priority")}
                      </label>
                      <select
                        value={priority}
                        onChange={(e) => setPriority(e.target.value as Priority)}
                        className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm"
                      >
                        {PRIORITIES.map((p) => (
                          <option key={p} value={p}>
                            {tc(`priority.${p}`)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-navy-800 mb-1">
                        {t("form.relatedService")}
                      </label>
                      <select
                        value={relatedService}
                        onChange={(e) => setRelatedService(e.target.value)}
                        className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm"
                      >
                        <option value="">{t("form.noneOption")}</option>
                        {(selected?.services_used ?? []).map((s) => (
                          <option key={s} value={s}>
                            {s.replace(/-/g, " ")}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-navy-800 mb-1">
                        {t("form.onBehalfOf")}
                      </label>
                      <select
                        value={contactID}
                        onChange={(e) => setContactID(e.target.value)}
                        className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm"
                      >
                        <option value="">{t("form.f2Initiated")}</option>
                        {contacts.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.full_name} ({c.email})
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-[11px] text-navy-500">
                        {t("form.onBehalfHint")}
                      </p>
                    </div>
                  </div>

                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={assignToSelf}
                      onChange={(e) => setAssignToSelf(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="font-medium text-navy-900">
                        {t("form.assignToMe")}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-navy-600">
                        {t("form.assignToMeHint")}
                      </span>
                    </span>
                  </label>
                </div>

                <div className="mt-6 flex justify-end gap-2 border-t border-navy-100 pt-4">
                  <Link
                    href={"/admin/tickets" as never}
                    className="btn-ghost"
                  >
                    {tc("cancel")}
                  </Link>
                  <button
                    type="button"
                    onClick={submit}
                    disabled={!canSubmit}
                    className="btn-accent"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> {tc("creating")}
                      </>
                    ) : (
                      <>
                        <Ticket className="h-4 w-4" /> {t("form.createButton")}
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
      )}
    </AdminShell>
  );
}

function TextField({ label, value, onChange, placeholder, maxLength }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; maxLength?: number;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-navy-800 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
      />
    </div>
  );
}

function tryMsg(e: unknown): string {
  if (!e) return "error";
  const anyE = e as { body?: string; message?: string };
  if (anyE.body) {
    try {
      return (JSON.parse(anyE.body) as { error?: string }).error ?? anyE.body;
    } catch {
      return anyE.body;
    }
  }
  return anyE.message ?? "error";
}
