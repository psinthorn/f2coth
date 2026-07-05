"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Save, CheckCircle2, FlaskConical, Zap, AlertTriangle, KeyRound, Eye, EyeOff } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import {
  adminApi,
  type AdminPaymentMethodConfig,
} from "@/lib/admin-api";

export default function AdminPaymentMethodsPage() {
  const t = useTranslations("admin.paymentMethods");
  const tc = useTranslations("common");
  const [methods, setMethods] = useState<AdminPaymentMethodConfig[] | null>(null);
  const [edits, setEdits] = useState<Record<string, AdminPaymentMethodConfig>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [modeErr, setModeErr] = useState<Record<string, string>>({});

  function load() {
    adminApi.listPaymentMethods().then((ms) => {
      setMethods(ms ?? []);
      const e: Record<string, AdminPaymentMethodConfig> = {};
      (ms ?? []).forEach((m) => (e[m.method] = m));
      setEdits(e);
    });
  }
  useEffect(load, []);

  // Per-method mode change — fires its own PUT immediately (vs the bulk
  // Save button), since flipping a method to production has different
  // blast radius than editing a display name and we want it audited
  // even when the admin doesn't click Save.
  async function changeMode(method: string, next: "sandbox" | "production") {
    const cur = edits[method];
    if (!cur || cur.mode === next) return;
    const promptKey = next === "production" ? "confirmGoLive" : "confirmGoSandbox";
    if (!window.confirm(t(promptKey, { method: t(`labels.${method}`) }))) return;

    // Optimistic update — flip the card colour immediately.
    patch(method, { mode: next });
    setModeErr((e) => { const { [method]: _, ...rest } = e; return rest; });
    setBusy(method + ".mode");
    try {
      await adminApi.updatePaymentMethod(method, { mode: next });
    } catch (e: unknown) {
      // Revert and surface the error.
      patch(method, { mode: cur.mode });
      const err = e as { status?: number; body?: string };
      const role = (() => {
        try {
          const u = JSON.parse(sessionStorage.getItem("f2_user") || "null") as { role?: string } | null;
          return u?.role ?? "";
        } catch { return ""; }
      })();
      setModeErr((m) => ({
        ...m,
        [method]: err.status === 403 && role !== "admin" ? t("modeAdminOnly") : (err.body || tc("error")),
      }));
    } finally {
      setBusy(null);
    }
  }

  function patch(method: string, patchValue: Partial<AdminPaymentMethodConfig>) {
    setEdits((e) => ({ ...e, [method]: { ...e[method], ...patchValue } }));
  }

  function patchCfg(method: string, key: string, value: string) {
    setEdits((e) => ({
      ...e,
      [method]: { ...e[method], config: { ...e[method].config, [key]: value } },
    }));
  }

  // PayPal config is nested {sandbox: {...}, live: {...}} — this helper
  // patches inside the chosen environment without nuking the other.
  function patchPayPalCfg(method: string, env: "sandbox" | "live", key: string, value: string) {
    setEdits((e) => {
      const prev = e[method].config as Record<string, unknown>;
      const prevEnv = (prev?.[env] as Record<string, unknown>) ?? {};
      return {
        ...e,
        [method]: {
          ...e[method],
          config: { ...prev, [env]: { ...prevEnv, [key]: value } },
        },
      };
    });
  }

  async function save(method: string) {
    setBusy(method);
    try {
      const m = edits[method];
      await adminApi.updatePaymentMethod(method, {
        enabled: m.enabled,
        display_name_en: m.display_name_en,
        display_name_th: m.display_name_th,
        instructions_en: m.instructions_en,
        instructions_th: m.instructions_th,
        config: m.config,
        sort_order: m.sort_order,
      });
      setSavedKey(method);
      setTimeout(() => setSavedKey(null), 2500);
    } finally {
      setBusy(null);
    }
  }

  if (!methods) {
    return (
      <AdminShell>
        <div className="text-navy-500"><Loader2 className="inline h-4 w-4 animate-spin" /> {tc("loading")}</div>
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <header className="mb-6">
        <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-navy-600">{t("subtitle")}</p>
      </header>

      <div className="space-y-4">
        {methods.map((m) => {
          const v = edits[m.method] ?? m;
          const fields = methodFields(m.method);
          const isSandbox = v.mode === "sandbox";
          return (
            <section
              key={m.method}
              className={`card border-l-4 ${isSandbox ? "border-l-amber-400" : "border-l-emerald-500"}`}
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {isSandbox ? (
                    <FlaskConical className="h-5 w-5 text-amber-500" />
                  ) : (
                    <Zap className="h-5 w-5 text-emerald-600" />
                  )}
                  <div>
                    <h2 className="font-display text-lg text-navy-900">{t(`labels.${m.method}`)}</h2>
                    <p className="text-xs text-navy-500">{m.method}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {/* Per-method mode dropdown — fires PUT immediately */}
                  <label className="inline-flex items-center gap-2 text-xs">
                    <span className="text-navy-600">{t("modeLabel")}</span>
                    <select
                      value={v.mode}
                      onChange={(e) => changeMode(m.method, e.target.value as "sandbox" | "production")}
                      disabled={busy === m.method + ".mode"}
                      className={`rounded-md border-2 px-2 py-1 text-sm font-medium ${
                        isSandbox ? "border-amber-300 bg-amber-50" : "border-emerald-300 bg-emerald-50"
                      }`}
                    >
                      <option value="sandbox">🧪 {t("modeSandbox")}</option>
                      <option value="production">⚡ {t("modeProduction")}</option>
                    </select>
                    {busy === m.method + ".mode" && <Loader2 className="h-3 w-3 animate-spin text-navy-400" />}
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={!!v.enabled}
                      onChange={(e) => patch(m.method, { enabled: e.target.checked })}
                    />
                    <span>{v.enabled ? t("enabled") : t("disabled")}</span>
                  </label>
                </div>
              </div>
              {modeErr[m.method] && (
                <p className="mb-2 text-sm text-red-700 inline-flex items-center gap-1">
                  <AlertTriangle className="h-4 w-4" /> {modeErr[m.method]}
                </p>
              )}
              <p className="mb-3 text-xs text-navy-500">
                {isSandbox ? t("methodSandboxBody") : t("methodProductionBody")}
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-xs text-navy-600">
                  {t("displayNameEN")}
                  <input
                    type="text"
                    value={v.display_name_en}
                    onChange={(e) => patch(m.method, { display_name_en: e.target.value })}
                    className="rounded-md border border-navy-200 px-3 py-2 text-sm"
                  />
                </label>
                <label className="grid gap-1 text-xs text-navy-600">
                  {t("displayNameTH")}
                  <input
                    type="text"
                    value={v.display_name_th}
                    onChange={(e) => patch(m.method, { display_name_th: e.target.value })}
                    className="rounded-md border border-navy-200 px-3 py-2 text-sm"
                  />
                </label>
                <label className="grid gap-1 text-xs text-navy-600 sm:col-span-2">
                  {t("instructionsEN")}
                  <textarea
                    rows={2}
                    value={v.instructions_en ?? ""}
                    onChange={(e) => patch(m.method, { instructions_en: e.target.value })}
                    className="rounded-md border border-navy-200 px-3 py-2 text-sm"
                  />
                </label>
                <label className="grid gap-1 text-xs text-navy-600 sm:col-span-2">
                  {t("instructionsTH")}
                  <textarea
                    rows={2}
                    value={v.instructions_th ?? ""}
                    onChange={(e) => patch(m.method, { instructions_th: e.target.value })}
                    className="rounded-md border border-navy-200 px-3 py-2 text-sm"
                  />
                </label>
              </div>

              <h3 className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wider text-navy-500">{t("methodConfig")}</h3>
              {m.method === "paypal" ? (
                <PayPalCredentialPanels
                  config={(v.config as PayPalConfigShape) ?? { sandbox: {}, live: {} }}
                  activeMode={v.mode}
                  patchCfg={(env, key, value) => patchPayPalCfg(m.method, env, key, value)}
                  t={t}
                />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {fields.map((f) => (
                    <label key={f} className="grid gap-1 text-xs text-navy-600 sm:col-span-2">
                      {f}
                      <input
                        type="text"
                        value={String((v.config as Record<string, unknown>)?.[f] ?? "")}
                        onChange={(e) => patchCfg(m.method, f, e.target.value)}
                        className="rounded-md border border-navy-200 px-3 py-2 text-sm font-mono"
                      />
                    </label>
                  ))}
                </div>
              )}

              <div className="mt-4 flex items-center justify-end gap-2">
                {savedKey === m.method && (
                  <span className="text-emerald-700 text-xs inline-flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> {t("saved")}
                  </span>
                )}
                <button
                  type="button"
                  disabled={busy === m.method}
                  onClick={() => save(m.method)}
                  className="btn-accent"
                >
                  {busy === m.method && <Loader2 className="h-4 w-4 animate-spin" />}
                  <Save className="h-4 w-4" /> {t("save")}
                </button>
              </div>
            </section>
          );
        })}
      </div>
    </AdminShell>
  );
}

// PayPal config payload shape used by the admin UI. client_secret is
// only present when the admin explicitly entered a new value — empty /
// omitted means "preserve the existing one". client_secret_set comes
// back from GET so the form can show "•••• already set" without ever
// receiving the actual value.
type PayPalEnvConfig = {
  client_id?: string;
  client_secret?: string;
  client_secret_set?: boolean;
  webhook_id?: string;
  merchant_email?: string;
};
type PayPalConfigShape = {
  sandbox?: PayPalEnvConfig;
  live?: PayPalEnvConfig;
};

function PayPalCredentialPanels({
  config, activeMode, patchCfg, t,
}: {
  config: PayPalConfigShape;
  activeMode: "sandbox" | "production";
  patchCfg: (env: "sandbox" | "live", key: keyof PayPalEnvConfig, value: string) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <PayPalEnvCard
        env="sandbox"
        label={t("paypalSandboxLabel")}
        active={activeMode === "sandbox"}
        cfg={config.sandbox ?? {}}
        patchCfg={(k, v) => patchCfg("sandbox", k, v)}
        t={t}
      />
      <PayPalEnvCard
        env="live"
        label={t("paypalLiveLabel")}
        active={activeMode === "production"}
        cfg={config.live ?? {}}
        patchCfg={(k, v) => patchCfg("live", k, v)}
        t={t}
      />
    </div>
  );
}

function PayPalEnvCard({
  env, label, active, cfg, patchCfg, t,
}: {
  env: "sandbox" | "live";
  label: string;
  active: boolean;
  cfg: PayPalEnvConfig;
  patchCfg: (k: keyof PayPalEnvConfig, v: string) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const secretSet = !!cfg.client_secret_set;
  // The form only carries client_secret when the admin actively wants
  // to change it. Otherwise we send "" → backend preserves existing.
  const editingSecret = typeof cfg.client_secret === "string";
  const [reveal, setReveal] = useState(false);

  return (
    <div
      className={`rounded-lg border-2 p-4 ${
        active ? (env === "sandbox" ? "border-amber-300 bg-amber-50/40" : "border-emerald-300 bg-emerald-50/40")
              : "border-navy-100 bg-white"
      }`}
    >
      <div className="mb-3 flex items-center justify-between">
        <h4 className="font-semibold text-navy-900 inline-flex items-center gap-2 text-sm">
          {env === "sandbox" ? <FlaskConical className="h-4 w-4 text-amber-600" /> : <Zap className="h-4 w-4 text-emerald-600" />}
          {label}
        </h4>
        {active && (
          <span className="text-[10px] uppercase tracking-wider rounded-full bg-navy-900 text-white px-2 py-0.5">
            {t("paypalActiveBadge")}
          </span>
        )}
      </div>

      <div className="grid gap-3">
        <label className="grid gap-1 text-xs text-navy-600">
          {t("paypalClientID")}
          <input
            type="text"
            value={cfg.client_id ?? ""}
            onChange={(e) => patchCfg("client_id", e.target.value)}
            className="rounded-md border border-navy-200 px-3 py-2 text-sm font-mono"
            placeholder={env === "sandbox" ? "AYsq...sandbox..." : "AYsq...live..."}
          />
        </label>

        <div className="grid gap-1 text-xs text-navy-600">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1">
              <KeyRound className="h-3 w-3" /> {t("paypalClientSecret")}
            </span>
            {secretSet && !editingSecret && (
              <span className="text-[10px] text-emerald-700 inline-flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> {t("paypalSecretSet")}
              </span>
            )}
          </div>
          {!editingSecret ? (
            <button
              type="button"
              onClick={() => patchCfg("client_secret", "")}
              className="rounded-md border border-dashed border-navy-300 px-3 py-2 text-sm text-navy-600 hover:border-accent-500 hover:text-accent-700 text-left"
            >
              {secretSet ? `•••••••••••  — ${t("paypalChangeSecret")}` : t("paypalSetSecret")}
            </button>
          ) : (
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={reveal ? "text" : "password"}
                  value={cfg.client_secret ?? ""}
                  onChange={(e) => patchCfg("client_secret", e.target.value)}
                  className="w-full rounded-md border border-navy-200 px-3 py-2 pr-9 text-sm font-mono"
                  placeholder={t("paypalSecretPlaceholder")}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setReveal(!reveal)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-navy-400 hover:text-navy-700"
                  aria-label={reveal ? t("paypalHideSecret") : t("paypalRevealSecret")}
                >
                  {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {secretSet && (
                <button
                  type="button"
                  onClick={() => patchCfg("client_secret", undefined as unknown as string)}
                  className="rounded-md border border-navy-200 px-3 text-xs text-navy-600 hover:bg-navy-50"
                >
                  {t("paypalKeepSecret")}
                </button>
              )}
            </div>
          )}
        </div>

        <label className="grid gap-1 text-xs text-navy-600">
          {t("paypalWebhookID")}
          <input
            type="text"
            value={cfg.webhook_id ?? ""}
            onChange={(e) => patchCfg("webhook_id", e.target.value)}
            className="rounded-md border border-navy-200 px-3 py-2 text-sm font-mono"
            placeholder="WH-..."
          />
        </label>

        <label className="grid gap-1 text-xs text-navy-600">
          {t("paypalMerchantEmail")}
          <input
            type="email"
            value={cfg.merchant_email ?? ""}
            onChange={(e) => patchCfg("merchant_email", e.target.value)}
            className="rounded-md border border-navy-200 px-3 py-2 text-sm"
          />
        </label>
      </div>
    </div>
  );
}

function methodFields(method: string): string[] {
  switch (method) {
    case "bank_transfer":
      return ["bank_name", "account_name", "account_number", "branch", "swift"];
    case "thai_qr":
      return ["merchant_name", "qr_image_url"];
    case "promptpay":
      return ["merchant_name", "promptpay_id", "qr_image_url"];
    case "paypal":
      // PayPal is rendered by PayPalCredentialPanels — no generic fields.
      return [];
  }
  return [];
}
