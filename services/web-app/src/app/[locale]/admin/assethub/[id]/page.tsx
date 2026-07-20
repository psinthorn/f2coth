"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { Loader2, ArrowLeft, Save, Trash2, ArrowRightLeft, Wand2 } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import {
  assethubApi, type AssetDevice, type AssetSite, type AssetOrg, type DeviceType, type DeviceStatus,
} from "@/lib/assethub-api";

type DetailTab = "hardware" | "network" | "software" | "history";
const DEVICE_TYPES: DeviceType[] = [
  "computer", "server", "nas", "router", "switch", "ap", "printer", "camera", "phone", "tablet", "iot", "unknown",
];
const STATUSES: DeviceStatus[] = ["active", "retired", "missing"];

export default function AssetHubDeviceDetail() {
  const t = useTranslations("admin.assethub");
  const router = useRouter();
  const params = useParams();
  const search = useSearchParams();
  const id = String(params.id);
  const customerId = search.get("c") ?? "";

  const [device, setDevice] = useState<AssetDevice | null>(null);
  const [sites, setSites] = useState<AssetSite[]>([]);
  const [orgs, setOrgs] = useState<AssetOrg[]>([]);
  const [history, setHistory] = useState<{ id: string; source: string; received_at: string }[]>([]);
  const [tab, setTab] = useState<DetailTab>("hardware");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [moveTo, setMoveTo] = useState("");
  const [moving, setMoving] = useState(false);
  const [err, setErr] = useState("");

  // editable fields
  const [edit, setEdit] = useState({ device_type: "", asset_tag: "", assigned_user: "", status: "", site_id: "", notes: "" });

  useEffect(() => {
    if (!customerId) { setErr(t("detail.noOrg")); setLoading(false); return; }
    Promise.all([
      assethubApi.getDevice(customerId, id),
      assethubApi.listSites(customerId),
      assethubApi.deviceHistory(customerId, id),
      assethubApi.listOrgs().catch(() => [] as AssetOrg[]),
    ]).then(([d, s, h, o]) => {
      setDevice(d);
      setSites(s);
      setHistory(h);
      setOrgs(o);
      setEdit({
        device_type: d.device_type, asset_tag: d.asset_tag ?? "", assigned_user: d.assigned_user ?? "",
        status: d.status, site_id: d.site_id ?? "", notes: d.notes ?? "",
      });
    }).catch((e) => setErr(String(e))).finally(() => setLoading(false));
  }, [customerId, id, t]);

  async function save() {
    setSaving(true);
    try {
      await assethubApi.patchDevice(id, {
        device_type: edit.device_type as DeviceType,
        asset_tag: edit.asset_tag,
        assigned_user: edit.assigned_user,
        status: edit.status as DeviceStatus,
        site_id: edit.site_id || undefined,
        notes: edit.notes,
      });
    } catch (e) { setErr(String(e)); } finally { setSaving(false); }
  }

  async function remove() {
    if (!device) return;
    if (!confirm(t("detail.confirmDelete", { name: device.hostname || device.primary_ip || id.slice(0, 8) }))) return;
    try {
      await assethubApi.deleteDevice(id);
      router.push("/admin/assethub");
    } catch (e) { setErr(String(e)); }
  }

  async function move() {
    if (!moveTo || !device) return;
    const target = orgs.find((o) => o.id === moveTo);
    if (!confirm(t("detail.moveConfirm", { name: device.hostname || device.primary_ip || id.slice(0, 8), org: target?.name ?? "" }))) return;
    setMoving(true);
    try {
      await assethubApi.moveDevice(id, moveTo);
      router.push("/admin/assethub");
    } catch (e) { setErr(String(e)); } finally { setMoving(false); }
  }

  async function genTag() {
    try {
      const res = await assethubApi.generateTag(id);
      setEdit((e) => ({ ...e, asset_tag: res.asset_tag }));
    } catch (e) { setErr(String(e)); }
  }

  return (
    <AdminShell>
      <Link href={`/admin/assethub`} className="mb-4 inline-flex items-center text-sm text-navy-500 hover:text-navy-800">
        <ArrowLeft className="mr-1 h-4 w-4" />{t("detail.back")}
      </Link>
      {err && <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{err}</div>}
      {loading ? <Loader2 className="h-5 w-5 animate-spin text-navy-400" /> : device && (
        <>
          <header className="mb-4">
            <h1 className="font-display text-2xl text-navy-900">{device.hostname || device.primary_ip || id.slice(0, 8)}</h1>
            <p className="mt-1 text-sm text-navy-500">
              {device.device_type} · {device.brand} {device.model} · {t("detail.source")}: {device.source}
            </p>
          </header>

          {/* editable enrichment panel */}
          <div className="card mb-6 grid gap-3 p-4 sm:grid-cols-3">
            <Field label={t("detail.type")}>
              <select value={edit.device_type} onChange={(e) => setEdit({ ...edit, device_type: e.target.value })} className="w-full rounded border border-navy-200 px-2 py-1.5 text-sm">
                {DEVICE_TYPES.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
            <Field label={t("detail.status")}>
              <select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })} className="w-full rounded border border-navy-200 px-2 py-1.5 text-sm">
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label={t("detail.site")}>
              <select value={edit.site_id} onChange={(e) => setEdit({ ...edit, site_id: e.target.value })} className="w-full rounded border border-navy-200 px-2 py-1.5 text-sm">
                <option value="">—</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label={t("detail.assetTag")}>
              <div className="flex gap-1">
                <input value={edit.asset_tag} onChange={(e) => setEdit({ ...edit, asset_tag: e.target.value })} placeholder="F2-001-002-001" className="w-full rounded border border-navy-200 px-2 py-1.5 font-mono text-sm" />
                <button type="button" onClick={genTag} title={t("detail.genTagHint")} className="btn-ghost whitespace-nowrap px-2 text-xs">
                  <Wand2 className="inline h-3.5 w-3.5" />
                </button>
              </div>
            </Field>
            <Field label={t("detail.assignedUser")}>
              <input value={edit.assigned_user} onChange={(e) => setEdit({ ...edit, assigned_user: e.target.value })} className="w-full rounded border border-navy-200 px-2 py-1.5 text-sm" />
            </Field>
            <Field label={t("detail.notes")}>
              <input value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} className="w-full rounded border border-navy-200 px-2 py-1.5 text-sm" />
            </Field>
            <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
              <button onClick={save} disabled={saving} className="btn-accent text-sm">
                {saving ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : <Save className="mr-1 inline h-4 w-4" />}
                {t("detail.save")}
              </button>
              <div className="ml-auto flex items-center gap-2">
                <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className="rounded border border-navy-200 px-2 py-1.5 text-sm" title={t("detail.moveHint")}>
                  <option value="">{t("detail.moveTo")}</option>
                  {orgs.filter((o) => o.id !== customerId).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
                <button onClick={move} disabled={!moveTo || moving} className="btn-ghost text-sm disabled:opacity-40">
                  {moving ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : <ArrowRightLeft className="mr-1 inline h-4 w-4" />}{t("detail.move")}
                </button>
                <button onClick={remove} className="btn-ghost text-sm text-red-600">
                  <Trash2 className="mr-1 inline h-4 w-4" />{t("detail.delete")}
                </button>
              </div>
            </div>
          </div>

          <nav className="mb-4 flex gap-1 rounded-lg bg-navy-50 p-1 text-sm">
            {(["hardware", "network", "software", "history"] as DetailTab[]).map((k) => (
              <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1.5 ${tab === k ? "bg-white shadow font-medium" : "text-navy-600"}`}>
                {t(`detail.tab.${k}`)}
              </button>
            ))}
          </nav>

          {tab === "hardware" && (
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <Row label={t("detail.serial")} value={device.serial_number} />
              <Row label={t("detail.cpu")} value={device.cpu} />
              <Row label={t("detail.ram")} value={device.ram_mb ? `${device.ram_mb} MB` : ""} />
              <Row label={t("detail.storage")} value={device.storage_summary} />
              <Row label={t("detail.osCol")} value={[device.os_name, device.os_version].filter(Boolean).join(" ")} />
              <Row label={t("detail.role")} value={`${device.network_role} ${device.domain_or_workgroup_name ?? ""}`} />
            </dl>
          )}

          {tab === "network" && (
            <table className="w-full text-sm">
              <thead className="bg-navy-50 text-xs uppercase text-navy-500">
                <tr><th className="px-3 py-2 text-left">{t("detail.iface")}</th><th className="px-3 py-2 text-left">MAC</th><th className="px-3 py-2 text-left">IPv4</th><th className="px-3 py-2 text-left">{t("detail.ifaceType")}</th></tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {(device.interfaces ?? []).map((i, k) => (
                  <tr key={k}><td className="px-3 py-2">{i.name}</td><td className="px-3 py-2 font-mono text-xs">{i.mac}</td><td className="px-3 py-2">{i.ipv4?.join(", ")}</td><td className="px-3 py-2">{i.type} {i.ssid}</td></tr>
                ))}
                {!(device.interfaces ?? []).length && <tr><td colSpan={4} className="px-3 py-6 text-center text-navy-400">—</td></tr>}
              </tbody>
            </table>
          )}

          {tab === "software" && (
            <table className="w-full text-sm">
              <thead className="bg-navy-50 text-xs uppercase text-navy-500">
                <tr><th className="px-3 py-2 text-left">{t("detail.swName")}</th><th className="px-3 py-2 text-left">{t("detail.swVersion")}</th><th className="px-3 py-2 text-left">{t("detail.swVendor")}</th></tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {(device.software ?? []).map((s, k) => (
                  <tr key={k}><td className="px-3 py-2">{s.name}</td><td className="px-3 py-2 text-navy-500">{s.version}</td><td className="px-3 py-2 text-navy-500">{s.vendor}</td></tr>
                ))}
                {!(device.software ?? []).length && <tr><td colSpan={3} className="px-3 py-6 text-center text-navy-400">—</td></tr>}
              </tbody>
            </table>
          )}

          {tab === "history" && (
            <ul className="divide-y divide-navy-100 text-sm">
              {history.map((h) => (
                <li key={h.id} className="flex justify-between px-1 py-2">
                  <span className="text-navy-600">{h.source}</span>
                  <span className="text-navy-400">{h.received_at.slice(0, 16).replace("T", " ")}</span>
                </li>
              ))}
              {!history.length && <li className="py-6 text-center text-navy-400">—</li>}
            </ul>
          )}
        </>
      )}
    </AdminShell>
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

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between border-b border-navy-50 py-1">
      <dt className="text-navy-500">{label}</dt>
      <dd className="text-navy-900">{value || "—"}</dd>
    </div>
  );
}
