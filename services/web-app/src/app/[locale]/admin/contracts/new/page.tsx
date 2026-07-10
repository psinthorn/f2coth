"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { Loader2, ArrowLeft, ArrowRight, Check, FileSignature, Building2 } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import {
  contractApi, type Template, type Party, type MergeField,
} from "@/lib/contract-api";
import { formatTHB } from "../_shared";

type Step = 1 | 2 | 3;

export default function NewContractPage() {
  const t = useTranslations("admin.contracts");
  const tc = useTranslations("common");
  const router = useRouter();

  const [step, setStep] = useState<Step>(1);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [template, setTemplate] = useState<Template | null>(null);

  // Party selection / creation
  const [parties, setParties] = useState<Party[]>([]);
  const [partySearch, setPartySearch] = useState("");
  const [partyId, setPartyId] = useState<string>("");
  const [newParty, setNewParty] = useState(false);
  const [partyForm, setPartyForm] = useState<Partial<Party>>({});

  // Merge data (step 3)
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    contractApi.listTemplates(true).then((d) => setTemplates(d.templates ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (step === 2) contractApi.listParties(partySearch).then((d) => setParties(d.parties ?? [])).catch(() => {});
  }, [step, partySearch]);

  // When a template is picked, seed values from field defaults.
  function chooseTemplate(tpl: Template) {
    setTemplate(tpl);
    const seed: Record<string, unknown> = {};
    for (const f of tpl.merge_schema?.fields ?? []) {
      if (f.default !== undefined) seed[f.key] = f.default;
    }
    setValues(seed);
    setStep(2);
  }

  const fields = template?.merge_schema?.fields ?? [];

  // Auto-suggest fee_total = fee_monthly × term_months (still editable).
  useEffect(() => {
    const monthly = Number(values["fee_monthly"]);
    const term = Number(values["term_months"]);
    if (fields.some((f) => f.key === "fee_total") && monthly && term) {
      setValues((v) => (v["fee_total"] ? v : { ...v, fee_total: monthly * term }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values["fee_monthly"], values["term_months"]]);

  const feeTotal = Number(values["fee_total"]) || undefined;
  const effectiveDate = (values["effective_date"] as string) || undefined;

  async function submit() {
    if (!template) return;
    setSaving(true);
    setError("");
    try {
      let pid = partyId;
      if (newParty) {
        if (!partyForm.legal_name_en || !partyForm.legal_name_th) {
          setError(t("wizard.partyNameRequired"));
          setSaving(false);
          return;
        }
        const created = await contractApi.createParty(partyForm);
        pid = created.id;
      }
      if (!pid) {
        setError(t("wizard.pickParty"));
        setSaving(false);
        return;
      }
      const res = await contractApi.create({
        template_id: template.id,
        party_id: pid,
        merge_data: values,
        effective_date: effectiveDate,
        end_date: (values["end_date"] as string) || undefined,
        fee_total: feeTotal,
      });
      router.push(`/admin/contracts/${res.id}`);
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  }

  return (
    <AdminShell>
      <header className="mb-6">
        <h1 className="font-display text-3xl text-navy-900">{t("wizard.title")}</h1>
        <Stepper step={step} labels={[t("wizard.step1"), t("wizard.step2"), t("wizard.step3")]} />
      </header>

      {/* Step 1 — template */}
      {step === 1 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.length === 0 ? (
            <div className="text-navy-500">{tc("loading")}</div>
          ) : templates.map((tpl) => (
            <button
              key={tpl.id}
              data-testid={`tpl-${tpl.code}`}
              onClick={() => chooseTemplate(tpl)}
              className="card text-left transition hover:border-accent-300 hover:shadow"
            >
              <FileSignature className="mb-2 h-6 w-6 text-accent-500" />
              <div className="font-medium text-navy-900">{tpl.name}</div>
              <div className="mt-1 text-xs text-navy-500">
                {t("wizard.templateMeta", { code: tpl.code, version: tpl.version })}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Step 2 — party */}
      {step === 2 && (
        <div className="max-w-2xl">
          <div className="mb-4 flex gap-2">
            <button
              onClick={() => setNewParty(false)}
              className={`rounded-lg px-3 py-2 text-sm ${!newParty ? "bg-navy-800 text-white" : "border border-navy-200 text-navy-700"}`}
            >
              {t("wizard.existingParty")}
            </button>
            <button
              onClick={() => { setNewParty(true); setPartyId(""); }}
              className={`rounded-lg px-3 py-2 text-sm ${newParty ? "bg-navy-800 text-white" : "border border-navy-200 text-navy-700"}`}
            >
              {t("wizard.newParty")}
            </button>
          </div>

          {!newParty ? (
            <>
              <input
                value={partySearch}
                onChange={(e) => setPartySearch(e.target.value)}
                placeholder={t("wizard.searchParty")}
                className="mb-3 w-full rounded-lg border border-navy-200 px-3 py-2 text-sm"
              />
              <div className="max-h-80 space-y-2 overflow-y-auto">
                {parties.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPartyId(p.id)}
                    className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm ${partyId === p.id ? "border-accent-400 bg-accent-50" : "border-navy-200 hover:bg-navy-50"}`}
                  >
                    <Building2 className="h-4 w-4 text-navy-400" />
                    <span>
                      <span className="font-medium text-navy-900">{p.legal_name_en}</span>
                      {p.brand_name && <span className="ml-2 text-navy-400">{p.brand_name}</span>}
                    </span>
                    {partyId === p.id && <Check className="ml-auto h-4 w-4 text-accent-600" />}
                  </button>
                ))}
                {parties.length === 0 && <p className="text-sm text-navy-400">{t("wizard.noParties")}</p>}
              </div>
            </>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <PartyInput testId="party-legal-en" label={t("party.legalNameEn")} required value={partyForm.legal_name_en ?? ""} onChange={(v) => setPartyForm((f) => ({ ...f, legal_name_en: v }))} />
              <PartyInput testId="party-legal-th" label={t("party.legalNameTh")} required value={partyForm.legal_name_th ?? ""} onChange={(v) => setPartyForm((f) => ({ ...f, legal_name_th: v }))} />
              <PartyInput label={t("party.brandName")} value={partyForm.brand_name ?? ""} onChange={(v) => setPartyForm((f) => ({ ...f, brand_name: v }))} />
              <PartyInput label={t("party.taxId")} value={partyForm.tax_id ?? ""} onChange={(v) => setPartyForm((f) => ({ ...f, tax_id: v }))} />
              <PartyInput label={t("party.noticeEmail")} value={partyForm.notice_email ?? ""} onChange={(v) => setPartyForm((f) => ({ ...f, notice_email: v }))} />
              <PartyInput label={t("party.phone")} value={partyForm.phone ?? ""} onChange={(v) => setPartyForm((f) => ({ ...f, phone: v }))} />
              <div className="sm:col-span-2">
                <PartyInput label={t("party.address")} value={partyForm.address ?? ""} onChange={(v) => setPartyForm((f) => ({ ...f, address: v }))} />
              </div>
            </div>
          )}

          <WizardNav
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
            nextDisabled={!newParty && !partyId}
            backLabel={tc("back")} nextLabel={tc("next")}
          />
        </div>
      )}

      {/* Step 3 — merge form + summary */}
      {step === 3 && template && (
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div className="space-y-4">
            {fields.map((f) => (
              <MergeFieldInput
                key={f.key}
                field={f}
                value={values[f.key]}
                onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
              />
            ))}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <WizardNav
              onBack={() => setStep(2)}
              onNext={submit}
              nextLabel={saving ? tc("saving") : t("wizard.create")}
              nextDisabled={saving}
              backLabel={tc("back")}
              nextIcon={saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            />
          </div>

          <aside className="h-fit rounded-lg border border-navy-100 bg-navy-50 p-4 text-sm">
            <h3 className="mb-3 font-medium text-navy-900">{t("wizard.summary")}</h3>
            <SummaryRow label={t("wizard.template")} value={template.name} />
            <SummaryRow label={t("col.customer")} value={newParty ? (partyForm.legal_name_en ?? "—") : (parties.find((p) => p.id === partyId)?.legal_name_en ?? "—")} />
            <SummaryRow label={t("col.effective")} value={effectiveDate ?? "—"} />
            <SummaryRow label={t("col.fee")} value={formatTHB(feeTotal ?? null)} />
          </aside>
        </div>
      )}
    </AdminShell>
  );
}

function Stepper({ step, labels }: { step: number; labels: string[] }) {
  return (
    <ol className="mt-3 flex items-center gap-2 text-sm">
      {labels.map((l, i) => {
        const n = i + 1;
        const active = n === step;
        const done = n < step;
        return (
          <li key={l} className="flex items-center gap-2">
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${active ? "bg-accent-500 text-white" : done ? "bg-green-500 text-white" : "bg-navy-100 text-navy-500"}`}>
              {done ? "✓" : n}
            </span>
            <span className={active ? "text-navy-900" : "text-navy-400"}>{l}</span>
            {n < labels.length && <span className="text-navy-200">—</span>}
          </li>
        );
      })}
    </ol>
  );
}

function WizardNav({ onBack, onNext, nextDisabled, backLabel, nextLabel, nextIcon }: {
  onBack: () => void; onNext: () => void; nextDisabled?: boolean;
  backLabel: string; nextLabel: string; nextIcon?: React.ReactNode;
}) {
  return (
    <div className="mt-6 flex items-center justify-between">
      <button onClick={onBack} className="inline-flex items-center gap-2 text-sm text-navy-600 hover:text-navy-900">
        <ArrowLeft className="h-4 w-4" /> {backLabel}
      </button>
      <button
        onClick={onNext}
        disabled={nextDisabled}
        className="inline-flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-50"
      >
        {nextLabel} {nextIcon ?? <ArrowRight className="h-4 w-4" />}
      </button>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-2 flex justify-between gap-3">
      <span className="text-navy-500">{label}</span>
      <span className="text-right font-medium text-navy-800">{value}</span>
    </div>
  );
}

function PartyInput({ label, value, onChange, required, testId }: {
  label: string; value: string; onChange: (v: string) => void; required?: boolean; testId?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-navy-600">{label}{required && <span className="text-red-500"> *</span>}</span>
      <input data-testid={testId} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm" />
    </label>
  );
}

// Renders one merge field by type. Array fields (e.g. audit_schedule) use a
// compact JSON editor so the schema stays fully data-driven.
function MergeFieldInput({ field, value, onChange }: {
  field: MergeField; value: unknown; onChange: (v: unknown) => void;
}) {
  const t = useTranslations("admin.contracts");
  const label = field.label_en; // form uses EN labels; TH label shown as hint
  const common = "w-full rounded-lg border border-navy-200 px-3 py-2 text-sm";

  if (field.type === "enum" && field.options) {
    return (
      <Field field={field} label={label}>
        <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className={common}>
          {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </Field>
    );
  }
  if (field.type === "date") {
    return (
      <Field field={field} label={label}>
        <input type="date" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className={common} />
      </Field>
    );
  }
  if (field.type === "int" || field.type === "money") {
    return (
      <Field field={field} label={label}>
        <input type="number" value={value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} className={common} />
      </Field>
    );
  }
  if (field.type === "array") {
    return (
      <Field field={field} label={label} hint={t("wizard.arrayHint")}>
        <textarea
          rows={5}
          value={typeof value === "string" ? value : JSON.stringify(value ?? [], null, 2)}
          onChange={(e) => {
            try { onChange(JSON.parse(e.target.value)); }
            catch { onChange(e.target.value); } // keep raw until valid
          }}
          className={`${common} font-mono text-xs`}
        />
      </Field>
    );
  }
  return (
    <Field field={field} label={label}>
      <input value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className={common} />
    </Field>
  );
}

function Field({ field, label, hint, children }: {
  field: MergeField; label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between">
        <span className="text-sm text-navy-700">{label}{field.required && <span className="text-red-500"> *</span>}</span>
        <span className="text-xs text-navy-400">{field.label_th}</span>
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-navy-400">{hint}</span>}
    </label>
  );
}
