// Client-side API helper for /api/contracts/*. Mirrors checklist-api.ts —
// same sessionStorage access + refresh-token mechanism (see admin-api.ts for
// the canonical version). Kept separate so contract-only types tree-shake out
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

async function request<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const t = token();
  const res = await fetch(`${API_BASE}/contracts${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401 && !retried) {
    if (await attemptRefresh()) return request<T>(path, init, true);
    clearAuth();
    redirectToLogin();
    throw new HttpError(401, "unauthorized");
  }
  if (!res.ok) throw new HttpError(res.status, await res.text());
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ── Types ───────────────────────────────────────────────────────────────

export type ContractStatus =
  | "draft" | "sent" | "signed" | "active" | "expired" | "terminated";

export interface MergeField {
  key: string;
  type: "text" | "int" | "money" | "date" | "enum" | "array" | string;
  label_en: string;
  label_th: string;
  required?: boolean;
  default?: unknown;
  options?: string[];
  item_fields?: string[];
  group?: string;
}

export interface MergeSchema {
  fields: MergeField[];
}

export interface Template {
  id: string;
  code: string;
  name: string;
  version: string;
  doc_prefix: string;
  merge_schema: MergeSchema;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Party {
  id: string;
  customer_id?: string | null;
  legal_name_en: string;
  legal_name_th: string;
  brand_name?: string | null;
  tax_id?: string | null;
  address?: string | null;
  notice_email?: string | null;
  contact_person?: string | null;
  phone?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContractFile {
  id: string;
  contract_id: string;
  kind: "generated_docx" | "generated_pdf" | "signed_scan";
  filename: string;
  mime_type: string;
  size_bytes: number;
  sha256?: string | null;
  uploaded_by?: string | null;
  created_at: string;
}

export interface StatusEvent {
  id: string;
  contract_id: string;
  from_status?: string | null;
  to_status: string;
  note?: string | null;
  changed_by?: string | null;
  created_at: string;
}

export interface Contract {
  id: string;
  doc_no: string;
  template_id: string;
  template_code?: string;
  template_name?: string;
  party_id: string;
  party_name?: string;
  project_id?: string | null;
  merge_data: Record<string, unknown>;
  status: ContractStatus;
  effective_date?: string | null;
  end_date?: string | null;
  fee_total?: number | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  party?: Party;
  files?: ContractFile[];
  events?: StatusEvent[];
}

export interface ContractListParams {
  status?: string;
  party?: string;
  customer?: string;
  expiring?: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function qs(params: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

// ── API surface ─────────────────────────────────────────────────────────

export const contractApi = {
  // Templates
  listTemplates: (activeOnly = false) =>
    request<{ templates: Template[] }>(`/templates${activeOnly ? "?active=1" : ""}`),
  getTemplate: (id: string) => request<Template>(`/templates/${id}`),
  createTemplate: (input: Partial<Template>) =>
    request<{ id: string }>("/templates", { method: "POST", body: JSON.stringify(input) }),
  updateTemplate: (id: string, patch: Partial<Template>) =>
    request<void>(`/templates/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  // Parties
  listParties: (q?: string) =>
    request<{ parties: Party[] }>(`/parties${q ? qs({ q }) : ""}`),
  getParty: (id: string) => request<Party>(`/parties/${id}`),
  createParty: (input: Partial<Party>) =>
    request<{ id: string }>("/parties", { method: "POST", body: JSON.stringify(input) }),
  updateParty: (id: string, patch: Partial<Party>) =>
    request<void>(`/parties/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  // Contracts
  list: (params: ContractListParams = {}) =>
    request<{ contracts: Contract[] }>(`/${qs(params as Record<string, string | number | undefined>)}`),
  get: (id: string) => request<Contract>(`/${id}`),
  create: (input: {
    template_id: string;
    party_id: string;
    project_id?: string | null;
    merge_data?: Record<string, unknown>;
    effective_date?: string;
    end_date?: string;
    fee_total?: number;
  }) => request<{ id: string; doc_no: string }>("/", { method: "POST", body: JSON.stringify(input) }),
  update: (id: string, patch: {
    merge_data?: Record<string, unknown>;
    project_id?: string | null;
    effective_date?: string;
    end_date?: string;
    fee_total?: number;
  }) => request<void>(`/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  remove: (id: string) => request<void>(`/${id}`, { method: "DELETE" }),

  generate: (id: string, watermark: boolean) =>
    request<{ status: ContractStatus; watermark: boolean; doc_no: string }>(
      `/${id}/generate`, { method: "POST", body: JSON.stringify({ watermark }) }),

  changeStatus: (id: string, input: {
    to: ContractStatus;
    note?: string;
    effective_date?: string;
    end_date?: string;
  }) => request<{ status: ContractStatus }>(`/${id}/status`, { method: "POST", body: JSON.stringify(input) }),

  // Signed-scan upload bypasses the JSON request() wrapper (multipart).
  uploadSigned: async (id: string, file: File): Promise<{ id: string; status: ContractStatus }> => {
    const doUpload = async (retried = false): Promise<{ id: string; status: ContractStatus }> => {
      const fd = new FormData();
      fd.append("file", file);
      const t = token();
      const res = await fetch(`${API_BASE}/contracts/${id}/files`, {
        method: "POST",
        headers: { ...(t ? { Authorization: `Bearer ${t}` } : {}) },
        body: fd,
      });
      if (res.status === 401 && !retried) {
        if (await attemptRefresh()) return doUpload(true);
        clearAuth();
        redirectToLogin();
        throw new HttpError(401, "unauthorized");
      }
      if (!res.ok) throw new HttpError(res.status, await res.text());
      return res.json();
    };
    return doUpload();
  },

  // Fetch a stored file as a Blob (auth required) — for download + print.
  fetchFileBlob: async (id: string, fileId: string): Promise<Blob> => {
    const t = token();
    const res = await fetch(`${API_BASE}/contracts/${id}/files/${fileId}`, {
      headers: { ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    });
    if (!res.ok) throw new HttpError(res.status, await res.text());
    return res.blob();
  },
};

// Open a stored file in a new tab (print/preview) or trigger a download.
export async function openContractFile(
  id: string,
  file: ContractFile,
  mode: "view" | "download",
): Promise<void> {
  const blob = await contractApi.fetchFileBlob(id, file.id);
  const url = URL.createObjectURL(blob);
  if (mode === "download") {
    const a = document.createElement("a");
    a.href = url;
    a.download = file.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } else {
    window.open(url, "_blank");
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
