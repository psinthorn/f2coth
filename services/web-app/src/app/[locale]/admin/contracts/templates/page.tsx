"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Loader2, ArrowLeft, Save, ToggleLeft, ToggleRight } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { contractApi, type Template } from "@/lib/contract-api";

export default function TemplatesPage() {
  const t = useTranslations("admin.contracts");
  const tc = useTranslations("common");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => contractApi.listTemplates(false).then((d) => setTemplates(d.templates ?? [])).catch(() => {});
  useEffect(() => { load().finally(() => setLoading(false)); }, []);

  return (
    <AdminShell>
      <Link href="/admin/contracts" className="mb-4 inline-flex items-center gap-2 text-sm text-navy-600 hover:text-navy-900">
        <ArrowLeft className="h-4 w-4" /> {t("backToList")}
      </Link>
      <header className="mb-6">
        <h1 className="font-display text-3xl text-navy-900">{t("templates.title")}</h1>
        <p className="mt-1 text-sm text-navy-600">{t("templates.subtitle")}</p>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-navy-500"><Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}</div>
      ) : (
        <div className="space-y-4">
          {templates.map((tpl) => <TemplateCard key={tpl.id} tpl={tpl} onSaved={load} />)}
        </div>
      )}
    </AdminShell>
  );
}

function TemplateCard({ tpl, onSaved }: { tpl: Template; onSaved: () => void }) {
  const t = useTranslations("admin.contracts");
  const [name, setName] = useState(tpl.name);
  const [version, setVersion] = useState(tpl.version);
  const [prefix, setPrefix] = useState(tpl.doc_prefix);
  const [schema, setSchema] = useState(JSON.stringify(tpl.merge_schema ?? { fields: [] }, null, 2));
  const [active, setActive] = useState(tpl.is_active);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);

  async function save() {
    setBusy(true); setErr(""); setOk(false);
    try {
      const merge_schema = JSON.parse(schema);
      await contractApi.updateTemplate(tpl.id, { name, version, doc_prefix: prefix, merge_schema, is_active: active });
      setOk(true); onSaved();
    } catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <section className="card">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <code className="rounded bg-navy-100 px-2 py-0.5 text-xs text-navy-600">{tpl.code}</code>
          <span className="text-xs text-navy-400">{t("templates.codeLocked")}</span>
        </div>
        <button onClick={() => setActive((a) => !a)} className="inline-flex items-center gap-1 text-sm">
          {active ? <ToggleRight className="h-5 w-5 text-green-600" /> : <ToggleLeft className="h-5 w-5 text-navy-400" />}
          <span className={active ? "text-green-700" : "text-navy-400"}>{active ? t("templates.active") : t("templates.inactive")}</span>
        </button>
      </div>

      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <label className="text-sm sm:col-span-1">
          <span className="mb-1 block text-navy-600">{t("templates.name")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-navy-600">{t("templates.version")}</span>
          <input value={version} onChange={(e) => setVersion(e.target.value)} className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-navy-600">{t("templates.docPrefix")}</span>
          <input value={prefix} onChange={(e) => setPrefix(e.target.value)} className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm" />
        </label>
      </div>

      <label className="block text-sm">
        <span className="mb-1 block text-navy-600">{t("templates.mergeSchema")}</span>
        <textarea value={schema} onChange={(e) => setSchema(e.target.value)} rows={10}
          className="w-full rounded-lg border border-navy-200 px-3 py-2 font-mono text-xs" />
      </label>

      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      {ok && <p className="mt-2 text-sm text-green-600">{t("templates.saved")}</p>}

      <button onClick={save} disabled={busy}
        className="mt-3 inline-flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-50">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {t("templates.save")}
      </button>
    </section>
  );
}
