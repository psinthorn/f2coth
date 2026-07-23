"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";

// Remembers the org across navigation (back from a device, page reload) so the
// register doesn't snap back to the first org every time.
const ORG_STORE_KEY = "f2_assethub_org";
import { Loader2, Plus, Search, Download, RefreshCw, Trash2, KeyRound, FileSpreadsheet, Copy, Check, Terminal, Pencil, X, RotateCcw } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import {
  assethubApi,
  type AssetOrg, type AssetOverview, type AssetDevice, type AssetSite,
  type AssetToken, type AssetFinding, type AssetReport, type DeviceType, type AssetGroup,
} from "@/lib/assethub-api";

type Tab = "devices" | "discovery" | "workstations" | "sites" | "tokens" | "reports" | "guide";

const DEVICE_TYPES: DeviceType[] = [
  "computer", "server", "nas", "router", "switch", "ap", "printer", "camera", "phone", "tablet", "iot",
  "monitor", "ups", "keyboard", "mouse", "dock", "unknown",
];

export default function AssetHubAdminPage() {
  const t = useTranslations("admin.assethub");
  const tc = useTranslations("common");

  const [orgs, setOrgs] = useState<AssetOrg[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [overview, setOverview] = useState<AssetOverview | null>(null);
  const [tab, setTab] = useState<Tab>("devices");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    assethubApi.listOrgs()
      .then((o) => {
        setOrgs(o);
        if (!o.length) return;
        // Prefer the org passed back from a device (?c=), then the last one used
        // this session, then the first — but only if it still exists.
        const fromUrl = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("c") : null;
        const fromStore = typeof window !== "undefined" ? sessionStorage.getItem(ORG_STORE_KEY) : null;
        const valid = (id: string | null) => !!id && o.some((x) => x.id === id);
        const pick = [fromUrl, fromStore].find(valid) ?? o[0].id;
        setCustomerId((prev) => prev || (pick as string));
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the chosen org so it survives navigating away and back.
  useEffect(() => {
    if (customerId && typeof window !== "undefined") sessionStorage.setItem(ORG_STORE_KEY, customerId);
  }, [customerId]);

  useEffect(() => {
    if (!customerId) return;
    assethubApi.overview(customerId).then(setOverview).catch(() => setOverview(null));
  }, [customerId]);

  // Refresh the stat tiles + org device/untriaged counts after any mutation in a
  // tab (promote, manual create, delete) so the headline numbers don't go stale.
  function refreshCounts() {
    if (!customerId) return;
    assethubApi.overview(customerId).then(setOverview).catch(() => {});
    assethubApi.listOrgs().then(setOrgs).catch(() => {});
  }

  const selectedOrg = orgs.find((o) => o.id === customerId);

  return (
    <AdminShell>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-navy-900">{t("title")}</h1>
          <p className="mt-1 text-sm text-navy-600">{t("subtitle")}</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-navy-600">{t("org")}</span>
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className="rounded-lg border border-navy-200 px-3 py-2 text-sm"
          >
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name} ({o.devices})</option>
            ))}
          </select>
        </label>
      </header>

      {err && <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{err}</div>}
      {loading && <Loader2 className="h-5 w-5 animate-spin text-navy-400" />}

      {overview && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label={t("stat.total")} value={overview.total} />
          <StatTile label={t("stat.new30")} value={overview.new_30d} />
          <StatTile label={t("stat.stale30")} value={overview.stale_30d} tone={overview.stale_30d ? "amber" : undefined} />
          <StatTile label={t("stat.untriaged")} value={overview.untriaged} tone={overview.untriaged ? "accent" : undefined} />
        </div>
      )}

      <nav className="mb-4 flex flex-wrap gap-1 rounded-lg bg-navy-50 p-1 text-sm">
        {(["devices", "discovery", "workstations", "sites", "tokens", "reports", "guide"] as Tab[]).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded-md px-3 py-1.5 ${tab === k ? "bg-white shadow font-medium text-navy-900" : "text-navy-600"}`}
          >
            {t(`tab.${k}`)}
            {k === "discovery" && selectedOrg?.untriaged ? ` (${selectedOrg.untriaged})` : ""}
          </button>
        ))}
      </nav>

      {customerId && tab === "devices" && <DevicesTab customerId={customerId} t={t} tc={tc} onChanged={refreshCounts} />}
      {customerId && tab === "discovery" && <DiscoveryTab customerId={customerId} t={t} onChanged={refreshCounts} />}
      {customerId && tab === "workstations" && <WorkstationsTab customerId={customerId} t={t} />}
      {customerId && tab === "sites" && <SitesTab customerId={customerId} t={t} />}
      {customerId && tab === "tokens" && <TokensTab customerId={customerId} t={t} />}
      {customerId && tab === "reports" && <ReportsTab customerId={customerId} t={t} />}
      {customerId && tab === "guide" && <GuideTab overview={overview} t={t} />}
    </AdminShell>
  );
}

function StatTile({ label, value, tone }: { label: string; value: number; tone?: "amber" | "accent" }) {
  const toneCls = tone === "amber" ? "text-amber-600" : tone === "accent" ? "text-accent-600" : "text-navy-900";
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide text-navy-500">{label}</p>
      <p className={`mt-1 font-display text-3xl ${toneCls}`}>{value}</p>
    </div>
  );
}

// ---------------- Devices ----------------

// Section chips over the single device table (keyed by device_type). The
// backend maps each key to a device_type group (see categoryTypes in
// devices.go) so Network/Computers/CCTV stay one dataset, not separate modules.
const CATEGORIES = ["", "network", "computers", "cctv", "printers", "peripherals"] as const;

function DevicesTab({ customerId, t, tc, onChanged }: { customerId: string; t: any; tc: any; onChanged: () => void }) {
  const [devices, setDevices] = useState<AssetDevice[]>([]);
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  function load() {
    setLoading(true);
    assethubApi.listDevices(customerId, { category: category || undefined, q: q || undefined })
      .then(setDevices).finally(() => setLoading(false));
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [customerId, category]);

  async function remove(d: AssetDevice) {
    if (!confirm(t("devices.confirmDelete", { name: d.hostname || d.primary_ip || d.id.slice(0, 8) }))) return;
    await assethubApi.deleteDevice(d.id);
    load(); onChanged();
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-navy-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
            placeholder={t("devices.search")}
            className="rounded-lg border border-navy-200 py-2 pl-8 pr-3 text-sm"
          />
        </div>
        {CATEGORIES.map((c) => (
          <button key={c || "all"} onClick={() => setCategory(c)} className={chip(category === c)}>
            {t(`devices.cat.${c || "all"}`)}
          </button>
        ))}
        <button onClick={() => setShowAdd((v) => !v)} className="btn-accent ml-auto text-sm">
          <Plus className="mr-1 inline h-4 w-4" />{t("devices.add")}
        </button>
        <button onClick={() => assethubApi.exportCSV(customerId, { category: category || undefined, q: q || undefined })} className="btn-ghost text-sm">
          <Download className="mr-1 inline h-4 w-4" />{t("devices.csv")}
        </button>
      </div>

      {showAdd && (
        <AddDeviceForm customerId={customerId} t={t} onDone={() => { setShowAdd(false); load(); onChanged(); }} onCancel={() => setShowAdd(false)} />
      )}

      {loading ? <Loader2 className="h-5 w-5 animate-spin text-navy-400" /> : (
        <div className="overflow-x-auto rounded-lg border border-navy-100">
          <table className="w-full text-sm">
            <thead className="bg-navy-50 text-xs uppercase text-navy-500">
              <tr>
                <th className="px-3 py-2 text-left">{t("devices.hostname")}</th>
                <th className="px-3 py-2 text-left">{t("devices.serial")}</th>
                <th className="px-3 py-2 text-left">{t("devices.type")}</th>
                <th className="px-3 py-2 text-left">{t("devices.osCol")}</th>
                <th className="px-3 py-2 text-left">{t("devices.ip")}</th>
                <th className="px-3 py-2 text-left">{t("devices.lastSeen")}</th>
                <th className="px-3 py-2 text-right">{t("devices.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {devices.map((d) => (
                <tr key={d.id} className="hover:bg-navy-50/50">
                  <td className="px-3 py-2">
                    <Link href={`/admin/assethub/${d.id}?c=${customerId}`} className="font-medium text-accent-600 hover:underline">
                      {d.hostname || d.primary_ip || d.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-navy-600">{d.serial_number}</td>
                  <td className="px-3 py-2">{d.device_type}</td>
                  <td className="px-3 py-2 text-navy-600">{[d.os_name, d.os_version].filter(Boolean).join(" ")}</td>
                  <td className="px-3 py-2 text-navy-600">{d.primary_ip}</td>
                  <td className="px-3 py-2 text-navy-500">{d.last_seen?.slice(0, 10)}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => remove(d)} className="btn-ghost px-2 py-1 text-xs text-red-600" title={t("devices.delete")}>
                      <Trash2 className="inline h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {!devices.length && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-navy-400">{t("devices.empty")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Manual device entry (source=manual) for gear the collector/probe can't reach.
function AddDeviceForm({ customerId, t, onDone, onCancel }: { customerId: string; t: any; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({
    hostname: "", serial_number: "", device_type: "computer", brand: "", model: "",
    os_name: "", os_version: "", primary_ip: "", assigned_user: "", notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k: string) => (e: any) => setF((p) => ({ ...p, [k]: e.target.value }));

  async function save() {
    if (!f.hostname.trim() && !f.serial_number.trim()) { setError(t("devices.needIdent")); return; }
    setSaving(true); setError("");
    try {
      await assethubApi.createDevice({ customer_id: customerId, ...f });
      onDone();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally { setSaving(false); }
  }

  return (
    <div className="mb-3 rounded-lg border border-accent-200 bg-accent-50/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-navy-800">{t("devices.addTitle")}</span>
        <button onClick={onCancel} className="text-navy-400 hover:text-navy-700"><X className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <input value={f.hostname} onChange={set("hostname")} placeholder={t("devices.hostname")} className={inp} />
        <input value={f.serial_number} onChange={set("serial_number")} placeholder={t("devices.serial")} className={inp} />
        <select value={f.device_type} onChange={set("device_type")} className={inp}>
          {DEVICE_TYPES.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <input value={f.brand} onChange={set("brand")} placeholder={t("devices.brand")} className={inp} />
        <input value={f.model} onChange={set("model")} placeholder={t("devices.model")} className={inp} />
        <input value={f.os_name} onChange={set("os_name")} placeholder={t("devices.osName")} className={inp} />
        <input value={f.os_version} onChange={set("os_version")} placeholder={t("devices.osVersion")} className={inp} />
        <input value={f.primary_ip} onChange={set("primary_ip")} placeholder={t("devices.ip")} className={inp} />
        <input value={f.assigned_user} onChange={set("assigned_user")} placeholder={t("devices.assignedUser")} className={inp} />
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <div className="mt-2 flex gap-2">
        <button onClick={save} disabled={saving} className="btn-accent text-sm">
          {saving ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : <Plus className="mr-1 inline h-4 w-4" />}{t("devices.save")}
        </button>
        <button onClick={onCancel} className="btn-ghost text-sm">{t("devices.cancel")}</button>
      </div>
    </div>
  );
}

// ---------------- Discovery triage ----------------

const FINDING_STATUSES = ["untriaged", "promoted", "ignored"] as const;

function DiscoveryTab({ customerId, t, onChanged }: { customerId: string; t: any; onChanged: () => void }) {
  const [findings, setFindings] = useState<AssetFinding[]>([]);
  const [status, setStatus] = useState<string>("untriaged");
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    assethubApi.listFindings(customerId, status).then(setFindings).finally(() => setLoading(false));
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [customerId, status]);

  async function promote(f: AssetFinding, type: string) {
    await assethubApi.promoteFinding(f.id, { device_type: type });
    load(); onChanged();
  }
  async function ignore(f: AssetFinding) {
    await assethubApi.ignoreFinding(f.id);
    load(); onChanged();
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {FINDING_STATUSES.map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={chip(status === s)}>{t(`discovery.f.${s}`)}</button>
        ))}
        <p className="ml-2 text-xs text-navy-400">{t("discovery.probeNote")}</p>
      </div>
      {loading ? <Loader2 className="h-5 w-5 animate-spin text-navy-400" /> : (
        <div className="overflow-x-auto rounded-lg border border-navy-100">
          <table className="w-full text-sm">
            <thead className="bg-navy-50 text-xs uppercase text-navy-500">
              <tr>
                <th className="px-3 py-2 text-left">{t("discovery.ip")}</th>
                <th className="px-3 py-2 text-left">{t("discovery.mac")}</th>
                <th className="px-3 py-2 text-left">{t("discovery.vendor")}</th>
                <th className="px-3 py-2 text-left">{t("discovery.host")}</th>
                <th className="px-3 py-2 text-left">{t("discovery.guess")}</th>
                <th className="px-3 py-2 text-right">{t("discovery.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {findings.map((f) => (
                <PromoteRow key={f.id} f={f} status={status} onPromote={promote} onIgnore={ignore} t={t} />
              ))}
              {!findings.length && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-navy-400">{t("discovery.empty")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PromoteRow({ f, status, onPromote, onIgnore, t }: { f: AssetFinding; status: string; onPromote: (f: AssetFinding, ty: string) => void; onIgnore: (f: AssetFinding) => void; t: any }) {
  const [ty, setTy] = useState(f.suggested_type && f.suggested_type !== "unknown" ? f.suggested_type : "computer");
  return (
    <tr className="hover:bg-navy-50/50">
      <td className="px-3 py-2">{f.ip}</td>
      <td className="px-3 py-2 font-mono text-xs">{f.mac}</td>
      <td className="px-3 py-2">{f.vendor}</td>
      <td className="px-3 py-2">{f.hostname}</td>
      <td className="px-3 py-2 text-navy-500">{f.suggested_type}</td>
      <td className="px-3 py-2">
        {status === "untriaged" ? (
          <div className="flex items-center justify-end gap-2">
            <select value={ty} onChange={(e) => setTy(e.target.value)} className="rounded border border-navy-200 px-2 py-1 text-xs">
              {DEVICE_TYPES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <button onClick={() => onPromote(f, ty)} className="btn-accent px-2 py-1 text-xs">{t("discovery.promote")}</button>
            <button onClick={() => onIgnore(f)} className="btn-ghost px-2 py-1 text-xs">{t("discovery.ignore")}</button>
          </div>
        ) : (
          <span className="block text-right text-xs text-navy-400">{t(`discovery.f.${status}`)}</span>
        )}
      </td>
    </tr>
  );
}

// ---------------- Sites ----------------

// ---------------- Workstations (asset groups) ----------------

function WorkstationsTab({ customerId, t }: { customerId: string; t: any }) {
  const [groups, setGroups] = useState<AssetGroup[]>([]);
  const [name, setName] = useState("");
  const [dept, setDept] = useState("");
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    assethubApi.listGroups(customerId).then(setGroups).finally(() => setLoading(false));
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [customerId]);

  async function add() {
    if (!name.trim()) return;
    await assethubApi.createGroup({ customer_id: customerId, name: name.trim(), department: dept.trim() || undefined });
    setName(""); setDept(""); load();
  }
  async function remove(g: AssetGroup) {
    if (!confirm(t("groups.confirmDelete", { name: g.name }))) return;
    await assethubApi.deleteGroup(g.id); load();
  }

  if (loading) return <Loader2 className="h-5 w-5 animate-spin text-navy-400" />;
  return (
    <div>
      <p className="mb-3 text-sm text-navy-600">{t("groups.intro")}</p>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("groups.name")} className={inp} />
        <input value={dept} onChange={(e) => setDept(e.target.value)} placeholder={t("groups.department")} className={inp} />
        <button onClick={add} className="btn-accent text-sm"><Plus className="mr-1 inline h-4 w-4" />{t("groups.add")}</button>
      </div>
      <ul className="divide-y divide-navy-100 rounded-lg border border-navy-100">
        {groups.map((g) => (
          <GroupRow key={g.id} g={g} customerId={customerId} t={t} onSaved={load} onDelete={() => remove(g)} />
        ))}
        {!groups.length && <li className="px-3 py-8 text-center text-navy-400">{t("groups.empty")}</li>}
      </ul>
    </div>
  );
}

function GroupRow({ g, customerId, t, onSaved, onDelete }: { g: AssetGroup; customerId: string; t: any; onSaved: () => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(g.name);
  const [dept, setDept] = useState(g.department ?? "");
  const [members, setMembers] = useState<AssetDevice[] | null>(null);

  async function save() {
    if (!name.trim()) return;
    await assethubApi.updateGroup(g.id, { name: name.trim(), department: dept.trim() || undefined });
    setEditing(false); onSaved();
  }
  function toggle() {
    const next = !open; setOpen(next);
    if (next && members === null) assethubApi.listDevices(customerId, { group_id: g.id }).then(setMembers);
  }

  if (editing) {
    return (
      <li className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
        <input value={name} onChange={(e) => setName(e.target.value)} className={inp} />
        <input value={dept} onChange={(e) => setDept(e.target.value)} placeholder={t("groups.department")} className={inp} />
        <button onClick={save} className="btn-accent px-2 py-1 text-xs">{t("sites.saveEdit")}</button>
        <button onClick={() => { setEditing(false); setName(g.name); setDept(g.department ?? ""); }} className="btn-ghost px-2 py-1 text-xs">{t("devices.cancel")}</button>
      </li>
    );
  }
  return (
    <li className="px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <button onClick={toggle} className="font-medium text-navy-900 hover:text-accent-600">{g.name}</button>
        {g.department && <span className="rounded bg-navy-50 px-1.5 py-0.5 text-xs text-navy-500">{g.department}</span>}
        <span className="ml-auto text-xs text-navy-500">{t("groups.members", { n: g.member_count })}</span>
        <button onClick={() => setEditing(true)} className="btn-ghost px-2 py-1 text-xs" title={t("sites.edit")}><Pencil className="inline h-3.5 w-3.5" /></button>
        <button onClick={onDelete} className="btn-ghost px-2 py-1 text-xs text-red-600" title={t("sites.delete")}><Trash2 className="inline h-3.5 w-3.5" /></button>
      </div>
      {open && (
        <ul className="mt-2 ml-2 border-l border-navy-100 pl-3">
          {members === null && <li className="py-1 text-xs text-navy-400"><Loader2 className="inline h-3 w-3 animate-spin" /></li>}
          {members?.map((m) => (
            <li key={m.id} className="flex items-center gap-2 py-1 text-xs">
              <Link href={`/admin/assethub/${m.id}?c=${customerId}`} className="text-navy-800 hover:text-accent-600">{m.hostname || m.model || m.serial_number || m.id.slice(0, 8)}</Link>
              <span className="text-navy-400">{m.device_type}</span>
              {m.asset_tag && <span className="ml-auto font-mono text-navy-500">{m.asset_tag}</span>}
            </li>
          ))}
          {members?.length === 0 && <li className="py-1 text-xs text-navy-400">{t("groups.noMembers")}</li>}
        </ul>
      )}
    </li>
  );
}

function SitesTab({ customerId, t }: { customerId: string; t: any }) {
  const [sites, setSites] = useState<AssetSite[]>([]);
  const [name, setName] = useState("");
  const [cidrs, setCidrs] = useState("");
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    assethubApi.listSites(customerId).then(setSites).finally(() => setLoading(false));
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [customerId]);

  async function add() {
    if (!name.trim()) return;
    await assethubApi.createSite({ customer_id: customerId, name, cidrs: cidrs.split(",").map((s) => s.trim()).filter(Boolean) });
    setName(""); setCidrs(""); load();
  }

  async function remove(s: AssetSite) {
    if (!confirm(t("sites.confirmDelete", { name: s.name }))) return;
    await assethubApi.deleteSite(s.id); load();
  }

  if (loading) return <Loader2 className="h-5 w-5 animate-spin text-navy-400" />;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("sites.name")} className={inp} />
        <input value={cidrs} onChange={(e) => setCidrs(e.target.value)} placeholder={t("sites.cidrs")} className={inp} />
        <button onClick={add} className="btn-accent text-sm"><Plus className="mr-1 inline h-4 w-4" />{t("sites.add")}</button>
      </div>
      <ul className="divide-y divide-navy-100 rounded-lg border border-navy-100">
        {sites.map((s) => (
          <SiteRow key={s.id} s={s} t={t} onSaved={load} onDelete={() => remove(s)} />
        ))}
        {!sites.length && <li className="px-3 py-8 text-center text-navy-400">{t("sites.empty")}</li>}
      </ul>
    </div>
  );
}

function SiteRow({ s, t, onSaved, onDelete }: { s: AssetSite; t: any; onSaved: () => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(s.name);
  const [cidrs, setCidrs] = useState(s.cidrs.join(", "));

  async function save() {
    if (!name.trim()) return;
    await assethubApi.updateSite(s.id, { name, cidrs: cidrs.split(",").map((c) => c.trim()).filter(Boolean) });
    setEditing(false); onSaved();
  }

  if (editing) {
    return (
      <li className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
        <input value={name} onChange={(e) => setName(e.target.value)} className={inp} />
        <input value={cidrs} onChange={(e) => setCidrs(e.target.value)} placeholder={t("sites.cidrs")} className={`${inp} flex-1 font-mono text-xs`} />
        <button onClick={save} className="btn-accent px-2 py-1 text-xs">{t("sites.saveEdit")}</button>
        <button onClick={() => { setEditing(false); setName(s.name); setCidrs(s.cidrs.join(", ")); }} className="btn-ghost px-2 py-1 text-xs">{t("devices.cancel")}</button>
      </li>
    );
  }
  return (
    <li className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
      <span className="font-medium text-navy-900">{s.name}</span>
      <span className="ml-auto font-mono text-xs text-navy-500">{s.cidrs.join(", ")}</span>
      <button onClick={() => setEditing(true)} className="btn-ghost px-2 py-1 text-xs" title={t("sites.edit")}><Pencil className="inline h-3.5 w-3.5" /></button>
      <button onClick={onDelete} className="btn-ghost px-2 py-1 text-xs text-red-600" title={t("sites.delete")}><Trash2 className="inline h-3.5 w-3.5" /></button>
    </li>
  );
}

// ---------------- Tokens ----------------

function TokensTab({ customerId, t }: { customerId: string; t: any }) {
  const [tokens, setTokens] = useState<AssetToken[]>([]);
  const [sites, setSites] = useState<AssetSite[]>([]);
  const [label, setLabel] = useState("");
  const [siteId, setSiteId] = useState("");
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    Promise.all([
      assethubApi.listTokens(customerId).then(setTokens),
      assethubApi.listSites(customerId).then(setSites).catch(() => setSites([])),
    ]).finally(() => setLoading(false));
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [customerId]);

  async function create() {
    if (!label.trim()) return;
    const tok = await assethubApi.createToken({ customer_id: customerId, label, site_id: siteId || null });
    setSecret(tok.secret ?? "");
    setLabel(""); setSiteId(""); load();
  }
  async function revoke(id: string) { await assethubApi.revokeToken(id); load(); }
  async function del(tk: AssetToken) {
    if (!confirm(t("tokens.confirmDelete", { name: tk.label }))) return;
    await assethubApi.deleteToken(tk.id); load();
  }

  const siteName = (id?: string | null) => sites.find((s) => s.id === id)?.name;

  if (loading) return <Loader2 className="h-5 w-5 animate-spin text-navy-400" />;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("tokens.label")} className={inp} />
        <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className={inp} title={t("tokens.site")}>
          <option value="">{t("tokens.allSites")}</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button onClick={create} className="btn-accent text-sm"><KeyRound className="mr-1 inline h-4 w-4" />{t("tokens.create")}</button>
      </div>
      {secret && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
          <p className="font-medium text-amber-800">{t("tokens.secretOnce")}</p>
          <code className="mt-1 block break-all font-mono text-xs text-navy-900">{secret}</code>
        </div>
      )}
      <ul className="divide-y divide-navy-100 rounded-lg border border-navy-100">
        {tokens.map((tk) => (
          <TokenRow key={tk.id} tk={tk} sites={sites} siteName={siteName(tk.site_id)} t={t} onSaved={load} onRevoke={() => revoke(tk.id)} onDelete={() => del(tk)} />
        ))}
        {!tokens.length && <li className="px-3 py-8 text-center text-navy-400">{t("tokens.empty")}</li>}
      </ul>

      <InstallPanel token={secret || "<TOKEN>"} t={t} />
    </div>
  );
}

function TokenRow({ tk, sites, siteName, t, onSaved, onRevoke, onDelete }: { tk: AssetToken; sites: AssetSite[]; siteName?: string; t: any; onSaved: () => void; onRevoke: () => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(tk.label);
  const [siteId, setSiteId] = useState(tk.site_id ?? "");
  const [poll, setPoll] = useState(String(tk.poll_interval_min ?? 5));
  const [rescan, setRescan] = useState(String(tk.rescan_interval_min ?? 360));
  const [scanState, setScanState] = useState<"" | "requested">("");

  async function save() {
    await assethubApi.updateToken(tk.id, {
      label, site_id: siteId || null,
      poll_interval_min: Number(poll) || undefined,
      rescan_interval_min: Number(rescan) || undefined,
    });
    setEditing(false); onSaved();
  }
  async function scan() {
    await assethubApi.scanNow(tk.id);
    setScanState("requested");
    setTimeout(() => setScanState(""), 4000);
  }

  if (editing) {
    return (
      <li className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
        <input value={label} onChange={(e) => setLabel(e.target.value)} className={inp} />
        <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className={inp}>
          <option value="">{t("tokens.allSites")}</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <label className="flex items-center gap-1 text-xs text-navy-500">{t("tokens.pollMin")}
          <input type="number" min={1} value={poll} onChange={(e) => setPoll(e.target.value)} className={`${inp} w-16`} />
        </label>
        <label className="flex items-center gap-1 text-xs text-navy-500">{t("tokens.rescanMin")}
          <input type="number" min={1} value={rescan} onChange={(e) => setRescan(e.target.value)} className={`${inp} w-20`} />
        </label>
        <button onClick={save} className="btn-accent px-2 py-1 text-xs">{t("sites.saveEdit")}</button>
        <button onClick={() => { setEditing(false); setLabel(tk.label); setSiteId(tk.site_id ?? ""); }} className="btn-ghost px-2 py-1 text-xs">{t("devices.cancel")}</button>
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
      <span className="font-medium text-navy-900">{tk.label}</span>
      <span className="font-mono text-xs text-navy-400">{tk.token_prefix}…</span>
      {siteName && <span className="rounded-full bg-navy-100 px-2 py-0.5 text-xs text-navy-600">{siteName}</span>}
      <span className="text-xs text-navy-400">{tk.last_scan_at ? `${t("tokens.lastScan")}: ${tk.last_scan_at.slice(0, 16).replace("T", " ")}` : t("tokens.neverScanned")}</span>
      {tk.revoked_at && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-600">{t("tokens.revoked")}</span>}
      <div className="ml-auto flex items-center gap-1">
        {!tk.revoked_at && (
          <button onClick={scan} className="btn-ghost px-2 py-1 text-xs text-emerald-600" title={t("tokens.scanNowHint")}>
            <RefreshCw className="mr-1 inline h-3.5 w-3.5" />{scanState === "requested" ? t("tokens.scanRequested") : t("tokens.scanNow")}
          </button>
        )}
        {!tk.revoked_at && <button onClick={() => setEditing(true)} className="btn-ghost px-2 py-1 text-xs" title={t("tokens.edit")}><Pencil className="inline h-3.5 w-3.5" /></button>}
        {!tk.revoked_at && <button onClick={onRevoke} className="btn-ghost px-2 py-1 text-xs text-amber-600" title={t("tokens.revoke")}>{t("tokens.revoke")}</button>}
        <button onClick={onDelete} className="btn-ghost px-2 py-1 text-xs text-red-600" title={t("tokens.delete")}><Trash2 className="inline h-3.5 w-3.5" /></button>
      </div>
    </li>
  );
}

// ---------------- Install / onboarding ----------------

function InstallPanel({ token, t }: { token: string; t: any }) {
  const [serverUrl, setServerUrl] = useState(typeof window !== "undefined" ? window.location.origin : "");
  const origin = serverUrl.replace(/\/+$/, "");
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|$)/.test(origin);
  const base = `${origin}/api/assethub/collector`;
  // Auto-detect installers: one paste picks the OS + tool and installs deps.
  const autoUnix = `curl -fsSL ${base}/install.sh | F2_SERVER_URL="${origin}" F2_TOKEN="${token}" sh`;
  const autoWin = `$env:F2_SERVER_URL="${origin}"; $env:F2_TOKEN="${token}"; irm ${base}/install.ps1 | iex`;
  // All-in-one runner: preflight → collect (this box) + probe (if F2_CIDRS) → send.
  const runUnix = `curl -fsSL ${base}/run.sh | F2_SERVER_URL="${origin}" F2_TOKEN="${token}" F2_CIDRS="192.168.1.0/24" sh`;
  const runDaemon = `curl -fsSL ${base}/run.sh | F2_SERVER_URL="${origin}" F2_TOKEN="${token}" F2_CIDRS="192.168.1.0/24" F2_DAEMON=1 sh`;
  const linux = `curl -fsSL ${base}/collect.sh -o collect.sh && F2_SERVER_URL="${origin}" F2_TOKEN="${token}" bash collect.sh`;
  const win = `irm ${base}/collect.ps1 -OutFile collect.ps1; .\\collect.ps1 -ServerUrl "${origin}" -Token "${token}"`;
  const probe = `curl -fsSL ${base}/discover.sh -o discover.sh && F2_SERVER_URL="${origin}" F2_TOKEN="${token}" F2_CIDRS="192.168.1.0/24" bash discover.sh`;
  // Cleanup: removes only what the tools installed (recorded manifest) — no token needed.
  const uninstallUnix = `curl -fsSL ${base}/uninstall.sh | sh`;
  const uninstallWin = `irm ${base}/uninstall.ps1 | iex`;

  const downloads = [
    { name: "install.sh", label: t("install.autoUnix") },
    { name: "install.ps1", label: t("install.autoWin") },
    { name: "run.sh", label: t("install.runUnix") },
    { name: "run.ps1", label: t("install.runWin") },
    { name: "uninstall.sh", label: t("install.uninstallTitle") },
    { name: "uninstall.ps1", label: t("install.uninstallTitle") },
    { name: "collect.sh", label: t("install.linux") },
    { name: "collect.ps1", label: t("install.windows") },
    { name: "discover.sh", label: t("install.probe") },
    { name: "docker-compose.probe.yml", label: t("install.probeCompose") },
  ];

  return (
    <div className="card mt-6 p-4">
      <div className="mb-1 flex items-center gap-2">
        <Terminal className="h-4 w-4 text-navy-500" />
        <h3 className="font-display text-lg text-navy-900">{t("install.title")}</h3>
      </div>
      <p className="mb-3 text-sm text-navy-600">
        {t("install.desc")}
        {token !== "<TOKEN>" ? "" : ` ${t("install.tokenNote")}`}
      </p>

      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-navy-500">{t("install.serverUrl")}</label>
      <input
        value={serverUrl}
        onChange={(e) => setServerUrl(e.target.value)}
        placeholder="https://assets.example.com"
        className="mb-1 w-full rounded-lg border border-navy-200 px-3 py-2 font-mono text-sm"
      />
      {isLocal && <p className="mb-3 text-xs text-amber-600">{t("install.localHint")}</p>}
      {!isLocal && <div className="mb-3" />}

      <div className="mb-2 flex items-center gap-2">
        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">{t("install.autoBadge")}</span>
        <span className="text-xs text-navy-500">{t("install.autoDesc")}</span>
      </div>
      <CmdBlock label={t("install.autoUnix")} cmd={autoUnix} t={t} />
      <CmdBlock label={t("install.autoWin")} cmd={autoWin} t={t} />

      <p className="mb-1 mt-4 text-xs font-medium uppercase tracking-wide text-navy-400">{t("install.runTitle")}</p>
      <p className="mb-2 text-xs text-navy-500">{t("install.runDesc")}</p>
      <CmdBlock label={t("install.runUnix")} cmd={runUnix} t={t} />
      <CmdBlock label={t("install.runDaemon")} cmd={runDaemon} t={t} />

      <p className="mb-2 mt-4 text-xs font-medium uppercase tracking-wide text-navy-400">{t("install.manualTitle")}</p>
      <CmdBlock label={t("install.linux")} cmd={linux} t={t} />
      <CmdBlock label={t("install.windows")} cmd={win} t={t} />
      <CmdBlock label={t("install.probe")} cmd={probe} t={t} />

      <p className="mb-1 mt-4 text-xs font-medium uppercase tracking-wide text-navy-400">{t("install.uninstallTitle")}</p>
      <p className="mb-2 text-xs text-navy-500">{t("install.uninstallDesc")}</p>
      <CmdBlock label={t("install.autoUnix")} cmd={uninstallUnix} t={t} />
      <CmdBlock label={t("install.autoWin")} cmd={uninstallWin} t={t} />

      <div className="mt-3 flex flex-wrap gap-2">
        {downloads.map((d) => (
          <a key={d.name} href={`${base}/${d.name}`} className="btn-ghost text-xs">
            <Download className="mr-1 inline h-3.5 w-3.5" />{d.name}
          </a>
        ))}
      </div>
    </div>
  );
}

function CmdBlock({ label, cmd, t }: { label: string; cmd: string; t: any }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard?.writeText(cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <div className="mb-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-navy-500">{label}</span>
        <button onClick={copy} className="text-xs text-navy-500 hover:text-navy-800">
          {copied ? <><Check className="mr-1 inline h-3.5 w-3.5 text-emerald-500" />{t("install.copied")}</> : <><Copy className="mr-1 inline h-3.5 w-3.5" />{t("install.copy")}</>}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-lg bg-navy-900 px-3 py-2 text-xs text-navy-50"><code>{cmd}</code></pre>
    </div>
  );
}

// ---------------- Reports ----------------

function ReportsTab({ customerId, t }: { customerId: string; t: any }) {
  const [reports, setReports] = useState<AssetReport[]>([]);
  const [format, setFormat] = useState("xlsx");
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    assethubApi.listReports(customerId).then(setReports).finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
    const iv = setInterval(load, 6000); // poll while jobs render
    return () => clearInterval(iv);
    /* eslint-disable-next-line */
  }, [customerId]);

  async function generate() {
    await assethubApi.createReport({ customer_id: customerId, format });
    load();
  }
  async function retry(id: string) { await assethubApi.retryReport(id); load(); }
  async function remove(id: string) {
    if (!confirm(t("reports.confirmDelete"))) return;
    await assethubApi.deleteReport(id); load();
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <select value={format} onChange={(e) => setFormat(e.target.value)} className="rounded-lg border border-navy-200 px-3 py-2 text-sm">
          <option value="xlsx">XLSX</option>
          <option value="pdf">PDF</option>
          <option value="docx">DOCX</option>
        </select>
        <button onClick={generate} className="btn-accent text-sm"><FileSpreadsheet className="mr-1 inline h-4 w-4" />{t("reports.generate")}</button>
        <button onClick={load} className="btn-ghost text-sm"><RefreshCw className="mr-1 inline h-4 w-4" />{t("reports.refresh")}</button>
      </div>
      {loading && !reports.length ? <Loader2 className="h-5 w-5 animate-spin text-navy-400" /> : (
        <ul className="divide-y divide-navy-100 rounded-lg border border-navy-100">
          {reports.map((r) => (
            <li key={r.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span>
                <span className="font-medium uppercase text-navy-900">{r.format}</span>
                <span className="ml-2 text-navy-500">{r.created_at.slice(0, 16).replace("T", " ")}</span>
                <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${statusTone(r.status)}`}>{t(`reports.status.${r.status}`)}</span>
                {r.error && <span className="ml-2 text-xs text-red-500">{r.error}</span>}
              </span>
              <div className="flex items-center gap-1">
                {r.status === "done" && (
                  <button onClick={() => assethubApi.downloadReport(r.id, r.format)} className="btn-ghost px-2 py-1 text-xs">
                    <Download className="mr-1 inline h-3.5 w-3.5" />{t("reports.download")}
                  </button>
                )}
                {(r.status === "failed" || r.status === "dead") && (
                  <button onClick={() => retry(r.id)} className="btn-ghost px-2 py-1 text-xs text-blue-600" title={t("reports.retry")}>
                    <RotateCcw className="mr-1 inline h-3.5 w-3.5" />{t("reports.retry")}
                  </button>
                )}
                <button onClick={() => remove(r.id)} className="btn-ghost px-2 py-1 text-xs text-red-600" title={t("reports.delete")}>
                  <Trash2 className="inline h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
          {!reports.length && <li className="px-3 py-8 text-center text-navy-400">{t("reports.empty")}</li>}
        </ul>
      )}
    </div>
  );
}

// ---------------- Guide / legend ----------------

// Which device_type tags roll up into each Devices-tab category chip. Mirrors
// categoryTypes() in devices.go — kept here as the UI-side reference.
const CATEGORY_TYPES: Record<string, string[]> = {
  network: ["router", "switch", "ap", "nas"],
  computers: ["computer", "server", "phone", "tablet"],
  cctv: ["camera"],
  printers: ["printer", "iot", "unknown"],
};
const ROLES = ["domain", "workgroup", "standalone", "n/a"] as const;

// Normalise a raw os_name label to a known meaning key.
function osKey(label: string): string {
  const l = label.toLowerCase();
  if (l.includes("mac")) return "macos";
  if (l.includes("win")) return "windows";
  if (/(linux|ubuntu|debian|centos|fedora|rhel|alma|rocky)/.test(l)) return "linux";
  if (l.includes("ios")) return "ios";
  if (l.includes("android")) return "android";
  if (l === "unknown" || l === "") return "unknown";
  return "other";
}

function GuideTab({ overview, t }: { overview: AssetOverview | null; t: any }) {
  const typeCount = (label: string) => overview?.by_type.find((b) => b.label === label)?.count ?? 0;
  const roleCount = (label: string) => overview?.by_network_role.find((b) => b.label === label)?.count ?? 0;
  const catCount = (types: string[]) => types.reduce((s, ty) => s + typeCount(ty), 0);

  return (
    <div className="space-y-8">
      <p className="text-sm text-navy-600">{t("guide.intro")}</p>

      {/* Categories */}
      <section>
        <h3 className="mb-1 font-display text-lg text-navy-900">{t("guide.catTitle")}</h3>
        <p className="mb-3 text-xs text-navy-500">{t("guide.catIntro")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {Object.entries(CATEGORY_TYPES).map(([cat, types]) => (
            <div key={cat} className="card p-4">
              <div className="flex items-center justify-between">
                <span className="font-medium text-navy-900">{t(`devices.cat.${cat}`)}</span>
                <Pill n={catCount(types)} />
              </div>
              <p className="mt-1 text-xs text-navy-500">{t(`guide.cat.${cat}`)}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {types.map((ty) => (
                  <span key={ty} className="rounded bg-navy-100 px-1.5 py-0.5 text-[11px] text-navy-600">
                    {ty} · {typeCount(ty)}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Device type tags */}
      <section>
        <h3 className="mb-1 font-display text-lg text-navy-900">{t("guide.typeTitle")}</h3>
        <LegendTable
          t={t}
          rows={DEVICE_TYPES.map((ty) => ({ tag: ty, meaning: t(`guide.type.${ty}`), count: typeCount(ty) }))}
        />
      </section>

      {/* OS overview */}
      <section>
        <h3 className="mb-1 font-display text-lg text-navy-900">{t("guide.osTitle")}</h3>
        <p className="mb-3 text-xs text-navy-500">{t("guide.osIntro")}</p>
        {overview && overview.by_os.length ? (
          <LegendTable
            t={t}
            rows={overview.by_os.map((b) => ({ tag: b.label || "Unknown", meaning: t(`guide.os.${osKey(b.label)}`), count: b.count }))}
          />
        ) : (
          <p className="text-sm text-navy-400">{t("guide.noData")}</p>
        )}
      </section>

      {/* Network roles */}
      <section>
        <h3 className="mb-1 font-display text-lg text-navy-900">{t("guide.roleTitle")}</h3>
        <LegendTable
          t={t}
          rows={ROLES.map((r) => ({ tag: r, meaning: t(`guide.role.${r === "n/a" ? "na" : r}`), count: roleCount(r) }))}
        />
      </section>
    </div>
  );
}

function Pill({ n }: { n: number }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs ${n ? "bg-accent-50 text-accent-700" : "bg-navy-100 text-navy-500"}`}>{n}</span>;
}

function LegendTable({ rows, t }: { rows: { tag: string; meaning: string; count: number }[]; t: any }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-navy-100">
      <table className="w-full text-sm">
        <thead className="bg-navy-50 text-xs uppercase text-navy-500">
          <tr>
            <th className="px-3 py-2 text-left">{t("guide.colTag")}</th>
            <th className="px-3 py-2 text-left">{t("guide.colMeaning")}</th>
            <th className="px-3 py-2 text-right">{t("guide.colCount")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-navy-100">
          {rows.map((r) => (
            <tr key={r.tag} className="hover:bg-navy-50/50">
              <td className="px-3 py-2 font-mono text-xs text-navy-800">{r.tag}</td>
              <td className="px-3 py-2 text-navy-600">{r.meaning}</td>
              <td className="px-3 py-2 text-right"><Pill n={r.count} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------- helpers ----------------

const inp = "rounded-lg border border-navy-200 px-3 py-2 text-sm";

function chip(active: boolean): string {
  return `rounded-full border px-3 py-1 text-xs ${active ? "border-accent-400 bg-accent-50 text-accent-700" : "border-navy-200 text-navy-600"}`;
}

function statusTone(s: string): string {
  switch (s) {
    case "done": return "bg-emerald-50 text-emerald-600";
    case "failed": case "dead": return "bg-red-50 text-red-600";
    case "processing": return "bg-blue-50 text-blue-600";
    default: return "bg-navy-100 text-navy-600";
  }
}
