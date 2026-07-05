"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, ToggleRight, AlertTriangle, FlaskConical, CheckCircle2, Check } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { adminApi, type AppMode } from "@/lib/admin-api";

const MODES: { value: AppMode; icon: typeof CheckCircle2; tone: string }[] = [
  { value: "production",  icon: CheckCircle2,  tone: "emerald" },
  { value: "trial",       icon: FlaskConical,  tone: "amber" },
  { value: "maintenance", icon: AlertTriangle, tone: "red" },
];

export default function AdminAppModePage() {
  const t = useTranslations("admin.appMode");
  const tc = useTranslations("common");

  const [mode, setMode] = useState<AppMode>("production");
  const [messageEN, setMessageEN] = useState("");
  const [messageTH, setMessageTH] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string>("");

  useEffect(() => {
    adminApi.getAppMode()
      .then((d) => {
        setMode(d.mode);
        setMessageEN(d.message_en);
        setMessageTH(d.message_th);
        setUpdatedAt(d.updated_at);
      })
      .catch(() => setError(tc("errorLoad")))
      .finally(() => setLoading(false));
  }, [tc]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      await adminApi.setAppMode({ mode, message_en: messageEN, message_th: messageTH });
      setSaved(true);
    } catch (e: any) {
      setError(e?.body ? JSON.parse(e.body)?.error ?? t("saveError") : t("saveError"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <AdminShell>
        <div className="flex items-center gap-2 text-navy-500">
          <Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ToggleRight className="h-6 w-6 text-accent-700" />
            <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
          </div>
          <p className="mt-1 text-sm text-navy-600">{t("subtitle")}</p>
          {updatedAt && (
            <p className="mt-1 text-xs text-navy-400">
              {t("lastUpdated", { when: new Date(updatedAt).toLocaleString() })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {saved && !saving && (
            <span className="flex items-center gap-1 text-sm text-emerald-700">
              <Check className="h-4 w-4" /> {tc("saved")}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-accent disabled:opacity-60"
          >
            {saving ? (
              <>
                <Loader2 className="inline h-4 w-4 animate-spin mr-1" />
                {tc("saving")}
              </>
            ) : (
              tc("save")
            )}
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {MODES.map((m) => {
          const active = mode === m.value;
          const Icon = m.icon;
          return (
            <button
              key={m.value}
              type="button"
              onClick={() => { setMode(m.value); setSaved(false); }}
              className={`text-left card transition ${
                active
                  ? m.tone === "red"
                    ? "ring-2 ring-red-500 bg-red-50"
                    : m.tone === "amber"
                    ? "ring-2 ring-amber-500 bg-amber-50"
                    : "ring-2 ring-emerald-500 bg-emerald-50"
                  : "hover:border-navy-300"
              }`}
              aria-pressed={active}
            >
              <div className="flex items-center gap-2">
                <Icon
                  className={`h-5 w-5 ${
                    m.tone === "red"
                      ? "text-red-700"
                      : m.tone === "amber"
                      ? "text-amber-700"
                      : "text-emerald-700"
                  }`}
                />
                <h3 className="font-display text-lg text-navy-900">
                  {t(`modes.${m.value}.label`)}
                </h3>
              </div>
              <p className="mt-2 text-sm text-navy-600">{t(`modes.${m.value}.description`)}</p>
              <p className="mt-2 text-xs text-navy-500">
                {t(`modes.${m.value}.effect`)}
              </p>
            </button>
          );
        })}
      </div>

      <section className="mt-8 card space-y-4">
        <div>
          <h2 className="font-display text-lg text-navy-900">{t("messageHeading")}</h2>
          <p className="mt-1 text-sm text-navy-600">{t("messageHelp")}</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-navy-600 mb-1">EN</label>
            <textarea
              value={messageEN}
              onChange={(e) => { setMessageEN(e.target.value); setSaved(false); }}
              rows={3}
              maxLength={500}
              placeholder={t("messagePlaceholderEN")}
              className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-navy-600 mb-1">TH</label>
            <textarea
              value={messageTH}
              onChange={(e) => { setMessageTH(e.target.value); setSaved(false); }}
              rows={3}
              maxLength={500}
              placeholder={t("messagePlaceholderTH")}
              className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
            />
          </div>
        </div>
      </section>
    </AdminShell>
  );
}
