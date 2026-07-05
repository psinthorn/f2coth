// Client-side API helper for /api/checklists/*.
// Piggybacks on the same auth mechanism as admin-api (sessionStorage
// access + refresh tokens) — see admin-api.ts for the canonical version.
// We keep this in a separate file to isolate the checklist-only types
// so tree-shaking works and the admin bundle isn't polluted.

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
  const res = await fetch(`${API_BASE}/checklists${path}`, {
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

export interface Template {
  id: string;
  code: string;
  name_en: string;
  name_th: string;
  icon: string | null;
  sort_order: number;
  is_active: boolean;
  item_count: number;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  client_name: string;
  name: string;
  status: "active" | "paused" | "closed";
  start_date: string | null;
  end_date: string | null;
  iacc_company_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  visible_to_customer: boolean;
  created_at: string;
  updated_at: string;
  done_count?: number;
  total_count?: number;
  fail_count?: number;
}

export type ItemStatus = "pending" | "pass" | "fail" | "na";

export interface ProjectItem {
  id: string;
  project_module_id: string;
  text_en: string;
  text_th: string;
  sort_order: number;
  required: boolean;
  status: ItemStatus;
  note: string | null;
  photo_url: string | null;
  checked_by: string | null;
  checked_at: string | null;
  updated_at: string;
}

export interface ProjectModule {
  id: string;
  project_id: string;
  template_id: string;
  code: string;
  name_en: string;
  name_th: string;
  icon: string | null;
  position: number;
  added_by: string | null;
  added_at: string;
  items: ProjectItem[];
}

export interface ProjectBoard {
  project: Project;
  modules: ProjectModule[];
}

export interface ProgressModule {
  project_module_id: string;
  code: string;
  name_en: string;
  name_th: string;
  total: number;
  done: number;
  fail: number;
  na: number;
  pending: number;
}

export interface ProgressResponse {
  modules: ProgressModule[];
  totals: { total: number; done: number; pass: number; fail: number; na: number; pending: number };
}

export interface VisitLog {
  id: string;
  project_id: string;
  visit_date: string;
  summary: string;
  billable: boolean;
  amount: number | null;
  created_by: string | null;
  created_at: string;
}

export interface ReportItemChange {
  item_id: string;
  module_id: string;
  code: string;
  text_en: string;
  text_th: string;
  status: ItemStatus;
  note: string | null;
  photo_url: string | null;
  checked_at: string;
}

export interface Report {
  project_id: string;
  range: "weekly" | "monthly";
  from_date: string;
  to_date: string;
  items: ReportItemChange[];
  visits: VisitLog[];
  totals: ProgressResponse["totals"];
}

// ── Endpoints ───────────────────────────────────────────────────────────

export const checklistApi = {
  listTemplates: () => request<{ templates: Template[] }>("/templates"),
  getTemplate: (id: string) => request<{ template: Template; items: unknown[] }>(`/templates/${id}`),
  listProjects: () => request<{ projects: Project[] }>("/projects"),
  getProject: (id: string) => request<Project>(`/projects/${id}`),
  getBoard: (id: string) => request<ProjectBoard>(`/projects/${id}/board`),
  getProgress: (id: string) => request<ProgressResponse>(`/projects/${id}/progress`),
  getReport: (id: string, range: "weekly" | "monthly", date?: string) =>
    request<Report>(`/projects/${id}/report?range=${range}${date ? `&date=${date}` : ""}`),
  listVisits: (id: string) => request<{ visits: VisitLog[] }>(`/projects/${id}/visits`),

  createProject: (input: {
    client_name: string;
    name: string;
    status?: string;
    start_date?: string;
    end_date?: string;
    customer_id?: string | null;
    visible_to_customer?: boolean;
  }) => request<Project>("/admin/projects", { method: "POST", body: JSON.stringify(input) }),
  updateProject: (id: string, patch: Partial<Project>) =>
    request<void>(`/admin/projects/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteProject: (id: string) =>
    request<void>(`/admin/projects/${id}`, { method: "DELETE" }),

  attachModule: (projectId: string, templateId: string) =>
    request<{ id: string; position: number }>(`/projects/${projectId}/modules`, {
      method: "POST",
      body: JSON.stringify({ template_id: templateId }),
    }),
  detachModule: (projectId: string, pmId: string) =>
    request<void>(`/projects/${projectId}/modules/${pmId}`, { method: "DELETE" }),
  reorderModules: (projectId: string, order: string[]) =>
    request<void>(`/projects/${projectId}/modules/reorder`, {
      method: "PATCH",
      body: JSON.stringify({ order }),
    }),

  updateItem: (id: string, patch: { status?: ItemStatus; note?: string; photo_url?: string }) =>
    request<void>(`/items/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  // Uploads bypass the JSON request() wrapper because they need multipart.
  // Same auth (Bearer) + refresh flow, hand-rolled here so we don't touch
  // the shared request signature.
  uploadPhoto: async (file: File, projectId?: string): Promise<{ url: string }> => {
    const t = typeof window !== "undefined" ? sessionStorage.getItem("f2_access_token") : null;
    const fd = new FormData();
    fd.append("file", file, file.name);
    const base = process.env.NEXT_PUBLIC_API_BASE ?? "/api";
    // Pass project_id so the server can enforce a per-project photo
    // quota before allocating disk. Optional for callers outside the
    // project checklist flow (none today, but keep it backwards-safe).
    const qs = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
    const res = await fetch(`${base}/checklists/uploads${qs}`, {
      method: "POST",
      headers: { ...(t ? { Authorization: `Bearer ${t}` } : {}) },
      body: fd,
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  createVisit: (projectId: string, input: { visit_date?: string; summary: string; billable?: boolean; amount?: number }) =>
    request<VisitLog>(`/projects/${projectId}/visits`, { method: "POST", body: JSON.stringify(input) }),

  sendWeeklySummary: (projectId: string, date?: string) =>
    request<{ sent_to: string; items_updated: number }>(
      `/admin/projects/${projectId}/send-weekly-summary${date ? `?date=${date}` : ""}`,
      { method: "POST" },
    ),
};
