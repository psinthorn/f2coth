"use client";

// CustomerShowcasePanel — admin surface for the customers.show_on_website /
// website_* / consent_* columns (migration 046). Mounted from
// /admin/customers/[id]. Every save call goes through
// adminApi.updateCustomerShowcase which writes a single audit_log row per
// action (resource_type='customer_showcase') and enforces the "no showcase
// without consent" rule server-side.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle, ExternalLink, FileText, History, Loader2, Save, ShieldCheck,
} from "lucide-react";
import {
  adminApi,
  type AdminCustomer,
  type CustomerShowcaseAuditEntry,
  type CustomerShowcasePatch,
} from "@/lib/admin-api";

// ISO string (yyyy-mm-dd) from a nullable timestamp, for <input type="date">.
function toDateInput(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(0, 10);
}
function fromDateInput(v: string): string | null {
  return v ? new Date(`${v}T00:00:00Z`).toISOString() : null;
}

// Human status pill — used both in the panel header and consumable by the
// customer list page via <ShowcaseStatusBadge customer={c} />.
export function computeShowcaseStatus(c: Pick<AdminCustomer,
  "show_on_website" | "consent_granted_at" | "consent_expires_at"
>): "none" | "consent" | "live" | "expiring" | "expired" {
  const now = Date.now();
  const expiresMs = c.consent_expires_at ? Date.parse(c.consent_expires_at) : null;
  if (expiresMs !== null && expiresMs <= now) return "expired";
  if (!c.consent_granted_at) return "none";
  if (!c.show_on_website) return "consent";
  if (expiresMs !== null && expiresMs - now < 30 * 24 * 3600 * 1000) return "expiring";
  return "live";
}

export function ShowcaseStatusBadge({ customer }: { customer: Pick<AdminCustomer,
  "show_on_website" | "consent_granted_at" | "consent_expires_at"
> }) {
  const t = useTranslations("admin.customers.showcase.status");
  const s = computeShowcaseStatus(customer);
  const styles: Record<typeof s, string> = {
    none:     "bg-navy-100 text-navy-600",
    consent:  "bg-sky-100 text-sky-800",
    live:     "bg-emerald-100 text-emerald-800",
    expiring: "bg-amber-100 text-amber-900",
    expired:  "bg-red-100 text-red-800",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[s]}`}>
      {t(s)}
    </span>
  );
}

export default function CustomerShowcasePanel({
  customer, onChange,
}: {
  customer: AdminCustomer;
  onChange: (updated: AdminCustomer) => void;
}) {
  const t = useTranslations("admin.customers.showcase");
  const tc = useTranslations("common");

  const [showOnWebsite, setShowOnWebsite] = useState(customer.show_on_website);
  const [displayName, setDisplayName]     = useState(customer.website_display_name ?? "");
  const [logoURL, setLogoURL]             = useState(customer.website_logo_url ?? "");
  const [industryEN, setIndustryEN]       = useState(customer.website_industry_label ?? "");
  const [industryTH, setIndustryTH]       = useState(customer.website_industry_label_th ?? "");
  const [sortOrder, setSortOrder]         = useState<number>(customer.website_sort_order ?? 100);
  const [consentDoc, setConsentDoc]       = useState(customer.consent_document_url ?? "");
  const [grantedAt, setGrantedAt]         = useState(toDateInput(customer.consent_granted_at));
  const [grantedBy, setGrantedBy]         = useState(customer.consent_granted_by ?? "");
  const [expiresAt, setExpiresAt]         = useState(toDateInput(customer.consent_expires_at));
  const [consentNotes, setConsentNotes]   = useState(customer.consent_notes ?? "");

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const [audit, setAudit] = useState<CustomerShowcaseAuditEntry[] | null>(null);
  const [showAudit, setShowAudit] = useState(false);

  // The DB CHECK — mirrored client-side so we can disable the toggle UI
  // instead of relying on a 409 to teach the admin.
  const consentOnFile = grantedAt.trim().length > 0;

  // Warn 30 days before expiry so the account manager can start renewal.
  const daysToExpiry: number | null = expiresAt
    ? Math.floor((Date.parse(`${expiresAt}T00:00:00Z`) - Date.now()) / (24 * 3600 * 1000))
    : null;

  useEffect(() => {
    // Reset local state when the parent hands us a fresh customer (e.g. after
    // save round-trip or when navigating between customers).
    setShowOnWebsite(customer.show_on_website);
    setDisplayName(customer.website_display_name ?? "");
    setLogoURL(customer.website_logo_url ?? "");
    setIndustryEN(customer.website_industry_label ?? "");
    setIndustryTH(customer.website_industry_label_th ?? "");
    setSortOrder(customer.website_sort_order ?? 100);
    setConsentDoc(customer.consent_document_url ?? "");
    setGrantedAt(toDateInput(customer.consent_granted_at));
    setGrantedBy(customer.consent_granted_by ?? "");
    setExpiresAt(toDateInput(customer.consent_expires_at));
    setConsentNotes(customer.consent_notes ?? "");
  }, [customer]);

  async function loadAudit() {
    try {
      const res = await adminApi.listCustomerShowcaseAudit(customer.id);
      setAudit(res.entries ?? []);
    } catch (e: unknown) {
      setErr(tryMsg(e));
    }
  }

  async function save() {
    // Guard client-side too — server still enforces this via 409.
    if (showOnWebsite && !consentOnFile) {
      setErr(t("errors.consentRequired"));
      return;
    }
    setSaving(true);
    setErr("");
    setMsg("");
    // Build a full patch — send every field so the server records a complete
    // snapshot in audit_log if any of them changed.
    const patch: CustomerShowcasePatch = {
      show_on_website:            showOnWebsite,
      website_display_name:       displayName.trim() || null,
      website_logo_url:           logoURL.trim() || null,
      website_industry_label:     industryEN.trim() || null,
      website_industry_label_th:  industryTH.trim() || null,
      website_sort_order:         Number.isFinite(sortOrder) ? sortOrder : 100,
      consent_document_url:       consentDoc.trim() || null,
      consent_granted_at:         fromDateInput(grantedAt),
      consent_granted_by:         grantedBy.trim() || null,
      consent_expires_at:         fromDateInput(expiresAt),
      consent_notes:              consentNotes.trim() || null,
    };
    try {
      const updated = await adminApi.updateCustomerShowcase(customer.id, patch);
      onChange(updated);
      setMsg(t("saved"));
      if (audit !== null) await loadAudit();
    } catch (e: unknown) {
      setErr(tryMsg(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card mb-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-accent-700" />
          <h2 className="font-semibold text-navy-900">{t("title")}</h2>
          <ShowcaseStatusBadge customer={{
            show_on_website: showOnWebsite,
            consent_granted_at: fromDateInput(grantedAt),
            consent_expires_at: fromDateInput(expiresAt),
          }} />
        </div>
        <button
          type="button"
          onClick={() => { if (!showAudit && audit === null) loadAudit(); setShowAudit((v) => !v); }}
          className="btn-ghost text-xs"
        >
          <History className="h-3.5 w-3.5" /> {showAudit ? t("hideAudit") : t("showAudit")}
        </button>
      </div>

      <p className="mt-1 text-xs text-navy-600">{t("blurb")}</p>

      {daysToExpiry !== null && daysToExpiry < 30 && daysToExpiry >= 0 && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4" />
          <span>{t("expiryWarn", { days: daysToExpiry })}</span>
        </div>
      )}
      {daysToExpiry !== null && daysToExpiry < 0 && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4" />
          <span>{t("expiredWarn", { days: -daysToExpiry })}</span>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* -------------------- Consent block -------------------- */}
        <div className="rounded-lg border border-navy-100 bg-navy-50 p-4">
          <h3 className="text-sm font-semibold text-navy-900">{t("consent.title")}</h3>
          <p className="mt-1 text-xs text-navy-600">{t("consent.help")}</p>

          <div className="mt-4 space-y-3">
            <UrlField
              label={t("consent.documentURL")}
              value={consentDoc}
              onChange={setConsentDoc}
              placeholder={t("consent.documentURLPlaceholder")}
            />
            <DateField
              label={t("consent.grantedAt")}
              value={grantedAt}
              onChange={setGrantedAt}
            />
            <TextField
              label={t("consent.grantedBy")}
              value={grantedBy}
              onChange={setGrantedBy}
              placeholder={t("consent.grantedByPlaceholder")}
            />
            <DateField
              label={t("consent.expiresAt")}
              value={expiresAt}
              onChange={setExpiresAt}
              helper={t("consent.expiresAtHelper")}
            />
            <TextAreaField
              label={t("consent.notes")}
              value={consentNotes}
              onChange={setConsentNotes}
              rows={3}
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <a
              href="/docs/consent/basic-consent-th.md"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-navy-200 bg-white px-2 py-1 text-navy-800 hover:bg-navy-100"
            >
              <FileText className="h-3 w-3" /> {t("consent.templateBasicTH")} <ExternalLink className="h-3 w-3" />
            </a>
            <a
              href="/docs/consent/extended-consent-th.md"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-navy-200 bg-white px-2 py-1 text-navy-800 hover:bg-navy-100"
            >
              <FileText className="h-3 w-3" /> {t("consent.templateExtendedTH")} <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>

        {/* -------------------- Display block -------------------- */}
        <div className="rounded-lg border border-navy-100 p-4">
          <h3 className="text-sm font-semibold text-navy-900">{t("display.title")}</h3>
          <p className="mt-1 text-xs text-navy-600">{t("display.help")}</p>

          <label className="mt-4 flex items-start gap-3 rounded-lg border border-navy-200 bg-white p-3 text-sm">
            <input
              type="checkbox"
              checked={showOnWebsite}
              disabled={!consentOnFile}
              onChange={(e) => setShowOnWebsite(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-navy-900">{t("display.publish")}</span>
              <span className="mt-0.5 block text-xs text-navy-600">
                {consentOnFile ? t("display.publishHelp") : t("display.publishBlocked")}
              </span>
            </span>
          </label>

          <div className="mt-4 space-y-3">
            <TextField
              label={t("display.displayName")}
              value={displayName}
              onChange={setDisplayName}
              placeholder={customer.name}
              helper={t("display.displayNameHelper")}
            />
            <UrlField
              label={t("display.logoURL")}
              value={logoURL}
              onChange={setLogoURL}
              placeholder="https://…"
            />
            <TextField
              label={t("display.industryEN")}
              value={industryEN}
              onChange={setIndustryEN}
              placeholder={customer.industry ?? ""}
            />
            <TextField
              label={t("display.industryTH")}
              value={industryTH}
              onChange={setIndustryTH}
            />
            <NumberField
              label={t("display.sortOrder")}
              value={sortOrder}
              onChange={setSortOrder}
              helper={t("display.sortOrderHelper")}
            />
          </div>
        </div>
      </div>

      {err && (
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4" /> {err}
        </p>
      )}
      {msg && !err && (
        <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{msg}</p>
      )}

      <div className="mt-5 flex justify-end">
        <button onClick={save} disabled={saving} className="btn-accent">
          {saving
            ? <><Loader2 className="h-4 w-4 animate-spin" /> {tc("saving")}</>
            : <><Save className="h-4 w-4" /> {t("saveButton")}</>}
        </button>
      </div>

      {showAudit && (
        <div className="mt-6 rounded-lg border border-navy-100 bg-white p-4">
          <h3 className="text-sm font-semibold text-navy-900">{t("audit.title")}</h3>
          {audit === null ? (
            <p className="mt-2 text-sm text-navy-500"><Loader2 className="inline h-3.5 w-3.5 animate-spin" /> {tc("loading")}</p>
          ) : audit.length === 0 ? (
            <p className="mt-2 text-sm text-navy-500">{t("audit.empty")}</p>
          ) : (
            <ul className="mt-3 divide-y divide-navy-100">
              {audit.map((e, i) => (
                <li key={`${e.at}-${i}`} className="py-2 text-xs">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium text-navy-900">
                      {e.actor_email ?? t("audit.system")}
                    </span>
                    <span className="text-navy-500">{new Date(e.at).toLocaleString()}</span>
                  </div>
                  <ul className="mt-1 space-y-0.5 text-navy-700">
                    {Object.entries(e.changes ?? {}).map(([field, chg]) => (
                      <li key={field}>
                        <span className="text-navy-500">{field}:</span>{" "}
                        <span className="line-through">{formatAuditValue(chg?.from)}</span>
                        {" → "}
                        <span className="text-navy-900">{formatAuditValue(chg?.to)}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

// --------------- small typed field primitives (kept local) ---------------

function TextField({ label, value, onChange, placeholder, helper }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; helper?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-navy-800">{label}</label>
      <input
        type="text" value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-navy-200 bg-white px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
      />
      {helper && <p className="text-[11px] text-navy-500">{helper}</p>}
    </div>
  );
}
function UrlField(p: React.ComponentProps<typeof TextField>) {
  return <TextField {...p} />;
}
function DateField({ label, value, onChange, helper }: {
  label: string; value: string; onChange: (v: string) => void; helper?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-navy-800">{label}</label>
      <input
        type="date" value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-navy-200 bg-white px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
      />
      {helper && <p className="text-[11px] text-navy-500">{helper}</p>}
    </div>
  );
}
function NumberField({ label, value, onChange, helper }: {
  label: string; value: number; onChange: (v: number) => void; helper?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-navy-800">{label}</label>
      <input
        type="number" value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded-lg border border-navy-200 bg-white px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
      />
      {helper && <p className="text-[11px] text-navy-500">{helper}</p>}
    </div>
  );
}
function TextAreaField({ label, value, onChange, rows = 3 }: {
  label: string; value: string; onChange: (v: string) => void; rows?: number;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-navy-800">{label}</label>
      <textarea
        value={value} rows={rows}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-navy-200 bg-white px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
      />
    </div>
  );
}

function formatAuditValue(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return JSON.stringify(v);
}

function tryMsg(e: unknown): string {
  if (!e) return "error";
  const anyE = e as { body?: string; message?: string };
  if (anyE.body) {
    try { return (JSON.parse(anyE.body) as { error?: string }).error ?? anyE.body; } catch { return anyE.body; }
  }
  return anyE.message ?? "error";
}
