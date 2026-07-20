// Client-side API helper for /api/assethub/admin/*. Mirrors contract-api.ts —
// same sessionStorage access + refresh-token mechanism (see admin-api.ts for
// the canonical version). Kept separate so AssetHub-only types tree-shake out
// of other admin bundles.
import { HttpError, clearAuth, redirectToLogin } from "@/lib/admin-api";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/api";

function token(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem("f2_access_token");
}

function refreshTok(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem("f2_refresh_token");
}

async function attemptRefresh(): Promise<boolean> {
  const rt = refreshTok();
  if (!rt) return false;
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: rt }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    sessionStorage.setItem("f2_access_token", data.access_token);
    sessionStorage.setItem("f2_refresh_token", data.refresh_token);
    return true;
  } catch {
    return false;
  }
}

// base defaults to the staff admin tree; the portal page overrides it.
async function request<T>(path: string, init: RequestInit = {}, base = "/assethub/admin", retried = false): Promise<T> {
  const t = token();
  const res = await fetch(`${API_BASE}${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401 && !retried) {
    if (await attemptRefresh()) return request<T>(path, init, base, true);
    clearAuth();
    redirectToLogin();
    throw new HttpError(401, "unauthorized");
  }
  if (!res.ok) throw new HttpError(res.status, await res.text());
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// downloadBlob fetches a binary (CSV / report file) with auth and triggers a
// browser download. Mirrors the inline downloadCSV pattern in admin/invoices.
async function downloadBlob(path: string, filename: string, base = "/assethub/admin"): Promise<void> {
  const t = token();
  const res = await fetch(`${API_BASE}${base}${path}`, {
    headers: t ? { Authorization: `Bearer ${t}` } : {},
  });
  if (!res.ok) throw new HttpError(res.status, await res.text());
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ----- Types -----

export type DeviceType =
  | "computer" | "server" | "nas" | "router" | "switch" | "ap"
  | "printer" | "camera" | "phone" | "tablet" | "iot" | "unknown";
export type NetworkRole = "domain" | "workgroup" | "standalone" | "n/a";
export type DeviceStatus = "active" | "retired" | "missing";

export interface AssetOrg {
  id: string;
  slug: string;
  name: string;
  devices: number;
  untriaged: number;
}

export interface AssetSite {
  id: string;
  customer_id: string;
  name: string;
  cidrs: string[];
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssetToken {
  id: string;
  customer_id: string;
  site_id: string | null;
  label: string;
  token_prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
  poll_interval_min?: number;
  rescan_interval_min?: number;
  last_scan_at?: string | null;
  scan_requested_at?: string | null;
  secret?: string; // present only in the create response
}

export interface AssetIface {
  name: string | null;
  mac: string | null;
  ipv4: string[];
  ipv6: string[];
  type: string | null;
  ssid: string | null;
}
export interface AssetDisk {
  model: string | null;
  size_gb: number | null;
  free_gb: number | null;
  type: string | null;
  smart_status: string | null;
}
export interface AssetSoftware {
  name: string;
  version: string | null;
  vendor: string | null;
}

export interface AssetDevice {
  id: string;
  customer_id: string;
  site_id: string | null;
  site_name?: string | null;
  device_type: DeviceType;
  hostname: string | null;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  asset_tag: string | null;
  os_name: string | null;
  os_version: string | null;
  cpu: string | null;
  ram_mb: number | null;
  storage_summary: string | null;
  network_role: NetworkRole;
  domain_or_workgroup_name: string | null;
  primary_mac: string | null;
  primary_ip: string | null;
  assigned_user: string | null;
  status: DeviceStatus;
  source: "agent" | "probe" | "manual";
  first_seen: string;
  last_seen: string;
  notes: string | null;
  interfaces?: AssetIface[];
  disks?: AssetDisk[];
  software?: AssetSoftware[];
}

export interface AssetFinding {
  id: string;
  run_id: string;
  site_id: string | null;
  ip: string | null;
  mac: string | null;
  vendor: string | null;
  hostname: string | null;
  open_ports: string | null;
  snmp_sysdescr: string | null;
  suggested_type: string;
  status: "untriaged" | "promoted" | "ignored";
  device_id: string | null;
  created_at: string;
}

export interface AssetOverview {
  customer_id: string;
  total: number;
  new_30d: number;
  stale_30d: number;
  untriaged: number;
  by_type: { label: string; count: number }[];
  by_network_role: { label: string; count: number }[];
  by_os: { label: string; count: number }[];
}

export interface AssetReport {
  id: string;
  customer_id: string;
  site_id: string | null;
  format: "xlsx" | "pdf" | "docx";
  status: "queued" | "processing" | "done" | "failed" | "dead";
  attempts: number;
  file_path: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeviceFilters {
  type?: string;
  category?: string; // network | computers | cctv | printers (maps to device_type group)
  site_id?: string;
  os?: string;
  network_role?: string;
  status?: string;
  q?: string;
}

function qs(customerId: string, f: DeviceFilters = {}): string {
  const p = new URLSearchParams({ customer_id: customerId });
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  return p.toString();
}

// ----- Staff admin endpoints -----

export const assethubApi = {
  listOrgs: () => request<AssetOrg[]>("/orgs"),
  overview: (customerId: string) => request<AssetOverview>(`/overview?customer_id=${customerId}`),

  listSites: (customerId: string) => request<AssetSite[]>(`/sites?customer_id=${customerId}`),
  createSite: (body: { customer_id: string; name: string; cidrs: string[]; notes?: string }) =>
    request<{ id: string }>("/sites", { method: "POST", body: JSON.stringify(body) }),
  updateSite: (id: string, body: { name: string; cidrs: string[]; notes?: string }) =>
    request<{ id: string }>(`/sites/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteSite: (id: string) => request<void>(`/sites/${id}`, { method: "DELETE" }),

  listTokens: (customerId: string) => request<AssetToken[]>(`/tokens?customer_id=${customerId}`),
  createToken: (body: { customer_id: string; site_id?: string | null; label: string }) =>
    request<AssetToken>("/tokens", { method: "POST", body: JSON.stringify(body) }),
  updateToken: (id: string, body: { label?: string; site_id?: string | null; poll_interval_min?: number; rescan_interval_min?: number }) =>
    request<{ id: string }>(`/tokens/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  revokeToken: (id: string) => request<void>(`/tokens/${id}/revoke`, { method: "POST" }),
  deleteToken: (id: string) => request<void>(`/tokens/${id}`, { method: "DELETE" }),
  scanNow: (id: string) => request<{ id: string; status: string }>(`/tokens/${id}/scan`, { method: "POST" }),

  listDevices: (customerId: string, f?: DeviceFilters) => request<AssetDevice[]>(`/devices?${qs(customerId, f)}`),
  createDevice: (body: {
    customer_id: string; device_type?: string; hostname?: string; brand?: string; model?: string;
    serial_number?: string; asset_tag?: string; os_name?: string; os_version?: string; primary_ip?: string;
    primary_mac?: string; site_id?: string; assigned_user?: string; network_role?: string; notes?: string;
  }) => request<{ id: string }>("/devices", { method: "POST", body: JSON.stringify(body) }),
  getDevice: (customerId: string, id: string) => request<AssetDevice>(`/devices/${id}?customer_id=${customerId}`),
  patchDevice: (id: string, body: Partial<Pick<AssetDevice, "device_type" | "asset_tag" | "assigned_user" | "site_id" | "status" | "notes">>) =>
    request<{ id: string }>(`/devices/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteDevice: (id: string) => request<void>(`/devices/${id}`, { method: "DELETE" }),
  deviceHistory: (customerId: string, id: string) =>
    request<{ id: string; source: string; collected_at: string | null; received_at: string }[]>(`/devices/${id}/history?customer_id=${customerId}`),
  exportCSV: (customerId: string, f?: DeviceFilters) =>
    downloadBlob(`/devices.csv?${qs(customerId, f)}`, "assethub-devices.csv"),

  listFindings: (customerId: string, status = "untriaged") =>
    request<AssetFinding[]>(`/discovery/findings?customer_id=${customerId}&status=${status}`),
  promoteFinding: (id: string, body: { device_type: string; site_id?: string }) =>
    request<{ device_id: string }>(`/discovery/findings/${id}/promote`, { method: "POST", body: JSON.stringify(body) }),
  ignoreFinding: (id: string) => request<void>(`/discovery/findings/${id}/ignore`, { method: "POST" }),

  listReports: (customerId: string) => request<AssetReport[]>(`/reports?customer_id=${customerId}`),
  createReport: (body: { customer_id: string; site_id?: string | null; format: string }) =>
    request<{ id: string; status: string }>("/reports", { method: "POST", body: JSON.stringify(body) }),
  retryReport: (id: string) => request<{ id: string; status: string }>(`/reports/${id}/retry`, { method: "POST" }),
  deleteReport: (id: string) => request<void>(`/reports/${id}`, { method: "DELETE" }),
  downloadReport: (id: string, format: string) => downloadBlob(`/reports/${id}/download`, `handover.${format}`),
};

// ----- Customer portal endpoints (read-only, scoped by the customer JWT) -----
// The portal uses a separate sessionStorage token from staff (see portal-api.ts).

function portalToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem("f2_portal_access_token");
}

async function portalRequest<T>(path: string): Promise<T> {
  const t = portalToken();
  const res = await fetch(`${API_BASE}/assethub/portal${path}`, {
    headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) },
  });
  if (!res.ok) throw new HttpError(res.status, await res.text());
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const assethubPortal = {
  overview: () => portalRequest<AssetOverview>("/overview"),
  listSites: () => portalRequest<AssetSite[]>("/sites"),
  listDevices: (f?: DeviceFilters) => {
    const p = new URLSearchParams();
    if (f) for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
    const q = p.toString();
    return portalRequest<AssetDevice[]>(`/devices${q ? "?" + q : ""}`);
  },
  getDevice: (id: string) => portalRequest<AssetDevice>(`/devices/${id}`),
  exportCSV: async () => {
    const t = portalToken();
    const res = await fetch(`${API_BASE}/assethub/portal/devices.csv`, {
      headers: t ? { Authorization: `Bearer ${t}` } : {},
    });
    if (!res.ok) throw new HttpError(res.status, await res.text());
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "my-assets.csv";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  },
};
