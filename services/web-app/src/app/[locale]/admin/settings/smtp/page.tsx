"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Mail, Save, Send, AlertTriangle, CheckCircle2 } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { adminApi, type SMTPSettings } from "@/lib/admin-api";

const REDACTED = "••••••••";

export default function AdminSMTPSettingsPage() {
  const t = useTranslations("admin.smtp");
  const tc = useTranslations("common");
  const [s, setS] = useState<SMTPSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  useEffect(() => {
    adminApi.getSMTP()
      .then((r) => setS(r))
      .catch((e) => setFeedback({ kind: "err", msg: String(e) }))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    if (!s) return;
    setSaving(true); setFeedback(null);
    try {
      await adminApi.updateSMTP(s);
      // On save, the password field returns to the redacted placeholder so
      // subsequent saves without editing it keep the stored value.
      setS({ ...s, password: REDACTED });
      setFeedback({ kind: "ok", msg: t("saved") });
    } catch (e) {
      setFeedback({ kind: "err", msg: e instanceof Error ? e.message : "error" });
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    if (!testTo) return;
    setTesting(true); setFeedback(null);
    try {
      const r = await adminApi.testSMTP(testTo);
      setFeedback({ kind: "ok", msg: t("testSent", { to: r.to }) });
    } catch (e) {
      setFeedback({ kind: "err", msg: e instanceof Error ? e.message : "test failed" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <AdminShell>
      <header className="mb-6">
        <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-navy-600">{t("subtitle")}</p>
      </header>

      {loading || !s ? (
        <div className="flex items-center gap-2 text-navy-500">
          <Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}
        </div>
      ) : (
        <div className="grid gap-4 max-w-2xl">
          <section className="card space-y-4">
            <div className="flex items-center gap-2 text-navy-700">
              <Mail className="h-4 w-4" />
              <h2 className="font-medium">{t("server")}</h2>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm text-navy-700">{t("host")}</span>
                <input value={s.host} onChange={(e) => setS({ ...s, host: e.target.value })}
                  placeholder="smtp.example.com"
                  className="mt-1 w-full rounded-lg border border-navy-200 px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="text-sm text-navy-700">{t("port")}</span>
                <input type="number" value={s.port} onChange={(e) => setS({ ...s, port: parseInt(e.target.value, 10) || 587 })}
                  className="mt-1 w-full rounded-lg border border-navy-200 px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="text-sm text-navy-700">{t("username")}</span>
                <input value={s.username} onChange={(e) => setS({ ...s, username: e.target.value })}
                  autoComplete="off"
                  className="mt-1 w-full rounded-lg border border-navy-200 px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="text-sm text-navy-700">{t("password")}</span>
                <input type="password" value={s.password} onChange={(e) => setS({ ...s, password: e.target.value })}
                  autoComplete="new-password"
                  placeholder={REDACTED}
                  className="mt-1 w-full rounded-lg border border-navy-200 px-3 py-2 text-sm" />
                <span className="mt-1 block text-xs text-navy-500">{t("passwordHint")}</span>
              </label>
              <label className="col-span-2 block">
                <span className="text-sm text-navy-700">{t("fromAddress")}</span>
                <input value={s.from_address} onChange={(e) => setS({ ...s, from_address: e.target.value })}
                  placeholder="F2 Co., Ltd. <info@f2.co.th>"
                  className="mt-1 w-full rounded-lg border border-navy-200 px-3 py-2 text-sm" />
              </label>
              <label className="col-span-2 block">
                <span className="text-sm text-navy-700">{t("tlsMode")}</span>
                <select value={s.tls_mode} onChange={(e) => setS({ ...s, tls_mode: e.target.value as SMTPSettings["tls_mode"] })}
                  className="mt-1 w-full rounded-lg border border-navy-200 px-3 py-2 text-sm">
                  <option value="starttls">STARTTLS (587)</option>
                  <option value="tls">Implicit TLS (465)</option>
                  <option value="none">None (25)</option>
                </select>
              </label>
            </div>
            <div className="flex justify-end">
              <button onClick={save} disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2 text-sm text-white hover:bg-accent-600 disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {t("save")}
              </button>
            </div>
          </section>

          <section className="card space-y-3">
            <h2 className="font-medium text-navy-900">{t("testTitle")}</h2>
            <p className="text-sm text-navy-600">{t("testHint")}</p>
            <div className="flex gap-2">
              <input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)}
                placeholder="you@example.com"
                className="flex-1 rounded-lg border border-navy-200 px-3 py-2 text-sm" />
              <button onClick={test} disabled={testing || !testTo}
                className="inline-flex items-center gap-2 rounded-lg border border-navy-200 px-4 py-2 text-sm hover:bg-navy-50 disabled:opacity-50">
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {t("testSend")}
              </button>
            </div>
          </section>

          {feedback && (
            <div className={`card flex items-start gap-2 text-sm ${
              feedback.kind === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"
            }`}>
              {feedback.kind === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4" /> : <AlertTriangle className="mt-0.5 h-4 w-4" />}
              <span>{feedback.msg}</span>
            </div>
          )}
        </div>
      )}
    </AdminShell>
  );
}
