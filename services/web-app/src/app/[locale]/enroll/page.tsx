"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, CheckCircle2, MonitorSmartphone } from "lucide-react";
import F2LogoMark from "@/components/F2LogoMark";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/api";
const TYPES = ["phone", "tablet", "computer", "printer", "camera", "iot"];

// Public mobile enrollment form (spec §7): a device is self-registered in ~60s
// using an enrollment token carried in the URL — no login needed. Posts to the
// same enrollment-token-authed endpoint the collectors use.
export default function EnrollPage() {
  const t = useTranslations("enroll");
  const search = useSearchParams();
  const enrollToken = search.get("token") ?? "";

  const [form, setForm] = useState({ device_type: "phone", hostname: "", brand: "", model: "", serial_number: "", assigned_user: "", notes: "" });
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function submit() {
    setState("saving");
    setMsg("");
    try {
      const res = await fetch(`${API_BASE}/assethub/enroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${enrollToken}` },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(res.status === 401 ? t("badToken") : `HTTP ${res.status}`);
      setState("done");
    } catch (e: any) {
      setMsg(e.message ?? String(e));
      setState("error");
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <div className="mb-6 flex items-center gap-2">
        <F2LogoMark className="h-8 w-8" />
        <span className="font-display text-lg text-navy-900">F2 AssetHub</span>
      </div>

      {!enrollToken ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{t("noToken")}</div>
      ) : state === "done" ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-8 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-emerald-500" />
          <p className="font-medium text-navy-900">{t("done")}</p>
          <button onClick={() => { setForm({ ...form, hostname: "", serial_number: "", assigned_user: "" }); setState("idle"); }} className="btn-ghost mt-4 text-sm">
            {t("another")}
          </button>
        </div>
      ) : (
        <div className="card p-5">
          <div className="mb-4 flex items-center gap-2 text-navy-600">
            <MonitorSmartphone className="h-5 w-5" />
            <h1 className="font-display text-xl text-navy-900">{t("title")}</h1>
          </div>
          <div className="space-y-3">
            <Field label={t("type")}>
              <select value={form.device_type} onChange={(e) => setForm({ ...form, device_type: e.target.value })} className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm">
                {TYPES.map((ty) => <option key={ty} value={ty}>{ty}</option>)}
              </select>
            </Field>
            <Field label={t("name")}><Input v={form.hostname} on={(v) => setForm({ ...form, hostname: v })} /></Field>
            <Field label={t("brand")}><Input v={form.brand} on={(v) => setForm({ ...form, brand: v })} /></Field>
            <Field label={t("model")}><Input v={form.model} on={(v) => setForm({ ...form, model: v })} /></Field>
            <Field label={t("serial")}><Input v={form.serial_number} on={(v) => setForm({ ...form, serial_number: v })} /></Field>
            <Field label={t("user")}><Input v={form.assigned_user} on={(v) => setForm({ ...form, assigned_user: v })} /></Field>
            {state === "error" && <p className="text-sm text-red-600">{msg}</p>}
            <button onClick={submit} disabled={state === "saving"} className="btn-accent w-full">
              {state === "saving" ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : t("submit")}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wide text-navy-500">{label}</span>
      {children}
    </label>
  );
}
function Input({ v, on }: { v: string; on: (v: string) => void }) {
  return <input value={v} onChange={(e) => on(e.target.value)} className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm" />;
}
