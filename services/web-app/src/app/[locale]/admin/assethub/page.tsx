"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Loader2, Plus, Search, Download, RefreshCw, Trash2, KeyRound, FileSpreadsheet } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import {
  assethubApi,
  type AssetOrg, type AssetOverview, type AssetDevice, type AssetSite,
  type AssetToken, type AssetFinding, type AssetReport, type DeviceType,
} from "@/lib/assethub-api";

type Tab = "devices" | "discovery" | "sites" | "tokens" | "reports";

const DEVICE_TYPES: DeviceType[] = [
  "computer", "server", "nas", "router", "switch", "ap", "printer", "camera", "phone", "tablet", "iot", "unknown",
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
        if (o.length) setCustomerId((prev) => prev || o[0].id);
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!customerId) return;
    assethubApi.overview(customerId).then(setOverview).catch(() => setOverview(null));
  }, [customerId]);

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
        {(["devices", "discovery", "sites", "tokens", "reports"] as Tab[]).map((k) => (
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

      {customerId && tab === "devices" && <DevicesTab customerId={customerId} t={t} tc={tc} />}
      {customerId && tab === "discovery" && <DiscoveryTab customerId={customerId} t={t} />}
      {customerId && tab === "sites" && <SitesTab customerId={customerId} t={t} />}
      {customerId && tab === "tokens" && <TokensTab customerId={customerId} t={t} />}
      {customerId && tab === "reports" && <ReportsTab customerId={customerId} t={t} />}
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
const CATEGORIES = ["", "network", "computers", "cctv", "printers"] as const;

function DevicesTab({ customerId, t, tc }: { customerId: string; t: any; tc: any }) {
  const [devices, setDevices] = useState<AssetDevice[]>([]);
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    assethubApi.listDevices(customerId, { category: category || undefined, q: q || undefined })
      .then(setDevices).finally(() => setLoading(false));
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [customerId, category]);

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
        <button onClick={() => assethubApi.exportCSV(customerId, { category: category || undefined, q: q || undefined })} className="btn-ghost ml-auto text-sm">
          <Download className="mr-1 inline h-4 w-4" />{t("devices.csv")}
        </button>
      </div>

      {loading ? <Loader2 className="h-5 w-5 animate-spin text-navy-400" /> : (
        <div className="overflow-x-auto rounded-lg border border-navy-100">
          <table className="w-full text-sm">
            <thead className="bg-navy-50 text-xs uppercase text-navy-500">
              <tr>
                <th className="px-3 py-2 text-left">{t("devices.hostname")}</th>
                <th className="px-3 py-2 text-left">{t("devices.type")}</th>
                <th className="px-3 py-2 text-left">{t("devices.osCol")}</th>
                <th className="px-3 py-2 text-left">{t("devices.role")}</th>
                <th className="px-3 py-2 text-left">{t("devices.ip")}</th>
                <th className="px-3 py-2 text-left">{t("devices.lastSeen")}</th>
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
                  <td className="px-3 py-2">{d.device_type}</td>
                  <td className="px-3 py-2 text-navy-600">{[d.os_name, d.os_version].filter(Boolean).join(" ")}</td>
                  <td className="px-3 py-2">{d.network_role}</td>
                  <td className="px-3 py-2 text-navy-600">{d.primary_ip}</td>
                  <td className="px-3 py-2 text-navy-500">{d.last_seen?.slice(0, 10)}</td>
                </tr>
              ))}
              {!devices.length && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-navy-400">{t("devices.empty")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------- Discovery triage ----------------

function DiscoveryTab({ customerId, t }: { customerId: string; t: any }) {
  const [findings, setFindings] = useState<AssetFinding[]>([]);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    assethubApi.listFindings(customerId, "untriaged").then(setFindings).finally(() => setLoading(false));
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [customerId]);

  async function promote(f: AssetFinding, type: string) {
    await assethubApi.promoteFinding(f.id, { device_type: type });
    load();
  }
  async function ignore(f: AssetFinding) {
    await assethubApi.ignoreFinding(f.id);
    load();
  }

  if (loading) return <Loader2 className="h-5 w-5 animate-spin text-navy-400" />;
  return (
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
            <PromoteRow key={f.id} f={f} onPromote={promote} onIgnore={ignore} t={t} />
          ))}
          {!findings.length && (
            <tr><td colSpan={6} className="px-3 py-8 text-center text-navy-400">{t("discovery.empty")}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function PromoteRow({ f, onPromote, onIgnore, t }: { f: AssetFinding; onPromote: (f: AssetFinding, ty: string) => void; onIgnore: (f: AssetFinding) => void; t: any }) {
  const [ty, setTy] = useState(f.suggested_type && f.suggested_type !== "unknown" ? f.suggested_type : "computer");
  return (
    <tr className="hover:bg-navy-50/50">
      <td className="px-3 py-2">{f.ip}</td>
      <td className="px-3 py-2 font-mono text-xs">{f.mac}</td>
      <td className="px-3 py-2">{f.vendor}</td>
      <td className="px-3 py-2">{f.hostname}</td>
      <td className="px-3 py-2 text-navy-500">{f.suggested_type}</td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-2">
          <select value={ty} onChange={(e) => setTy(e.target.value)} className="rounded border border-navy-200 px-2 py-1 text-xs">
            {DEVICE_TYPES.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <button onClick={() => onPromote(f, ty)} className="btn-accent px-2 py-1 text-xs">{t("discovery.promote")}</button>
          <button onClick={() => onIgnore(f)} className="btn-ghost px-2 py-1 text-xs">{t("discovery.ignore")}</button>
        </div>
      </td>
    </tr>
  );
}

// ---------------- Sites ----------------

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

  if (loading) return <Loader2 className="h-5 w-5 animate-spin text-navy-400" />;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("sites.name")} className="rounded-lg border border-navy-200 px-3 py-2 text-sm" />
        <input value={cidrs} onChange={(e) => setCidrs(e.target.value)} placeholder={t("sites.cidrs")} className="rounded-lg border border-navy-200 px-3 py-2 text-sm" />
        <button onClick={add} className="btn-accent text-sm"><Plus className="mr-1 inline h-4 w-4" />{t("sites.add")}</button>
      </div>
      <ul className="divide-y divide-navy-100 rounded-lg border border-navy-100">
        {sites.map((s) => (
          <li key={s.id} className="flex items-center justify-between px-3 py-2 text-sm">
            <span className="font-medium text-navy-900">{s.name}</span>
            <span className="font-mono text-xs text-navy-500">{s.cidrs.join(", ")}</span>
          </li>
        ))}
        {!sites.length && <li className="px-3 py-8 text-center text-navy-400">{t("sites.empty")}</li>}
      </ul>
    </div>
  );
}

// ---------------- Tokens ----------------

function TokensTab({ customerId, t }: { customerId: string; t: any }) {
  const [tokens, setTokens] = useState<AssetToken[]>([]);
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    assethubApi.listTokens(customerId).then(setTokens).finally(() => setLoading(false));
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [customerId]);

  async function create() {
    if (!label.trim()) return;
    const tok = await assethubApi.createToken({ customer_id: customerId, label });
    setSecret(tok.secret ?? "");
    setLabel(""); load();
  }
  async function revoke(id: string) {
    await assethubApi.revokeToken(id); load();
  }

  if (loading) return <Loader2 className="h-5 w-5 animate-spin text-navy-400" />;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("tokens.label")} className="rounded-lg border border-navy-200 px-3 py-2 text-sm" />
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
          <li key={tk.id} className="flex items-center justify-between px-3 py-2 text-sm">
            <span>
              <span className="font-medium text-navy-900">{tk.label}</span>
              <span className="ml-2 font-mono text-xs text-navy-400">{tk.token_prefix}…</span>
              {tk.revoked_at && <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-600">{t("tokens.revoked")}</span>}
            </span>
            {!tk.revoked_at && (
              <button onClick={() => revoke(tk.id)} className="btn-ghost px-2 py-1 text-xs text-red-600">
                <Trash2 className="mr-1 inline h-3.5 w-3.5" />{t("tokens.revoke")}
              </button>
            )}
          </li>
        ))}
        {!tokens.length && <li className="px-3 py-8 text-center text-navy-400">{t("tokens.empty")}</li>}
      </ul>
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
              {r.status === "done" && (
                <button onClick={() => assethubApi.downloadReport(r.id, r.format)} className="btn-ghost px-2 py-1 text-xs">
                  <Download className="mr-1 inline h-3.5 w-3.5" />{t("reports.download")}
                </button>
              )}
            </li>
          ))}
          {!reports.length && <li className="px-3 py-8 text-center text-navy-400">{t("reports.empty")}</li>}
        </ul>
      )}
    </div>
  );
}

// ---------------- helpers ----------------

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
