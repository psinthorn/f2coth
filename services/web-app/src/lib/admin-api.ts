// Client-side API helper for /admin/*.
// Reads the access token from sessionStorage and adds Authorization headers.
// On 401, clears tokens and redirects to /admin/login.

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/api";

export class HttpError extends Error {
  constructor(public status: number, public body: string) {
    super(`HTTP ${status}: ${body}`);
  }
}

function token(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem("f2_access_token");
}

function refreshTok(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem("f2_refresh_token");
}

export function clearAuth() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem("f2_access_token");
  sessionStorage.removeItem("f2_refresh_token");
  sessionStorage.removeItem("f2_user");
}

export function redirectToLogin(returnTo?: string) {
  if (typeof window === "undefined") return;
  const next = returnTo ?? window.location.pathname + window.location.search;
  window.location.href = `/admin/login?next=${encodeURIComponent(next)}`;
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
    if (data.user) sessionStorage.setItem("f2_user", JSON.stringify(data.user));
    return true;
  } catch {
    return false;
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  retried = false,
): Promise<T> {
  const t = token();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (res.status === 401 && !retried) {
    if (await attemptRefresh()) {
      return request<T>(path, init, true);
    }
    clearAuth();
    redirectToLogin();
    throw new HttpError(401, "unauthorized");
  }

  if (!res.ok) {
    const body = await res.text();
    throw new HttpError(res.status, body);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ----- Types -----

export type LeadStatus = "new" | "contacted" | "qualified" | "won" | "lost" | "spam";
export type Role = "admin" | "editor" | "viewer";

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  company: string | null;
  property_name: string | null;
  property_type: string | null;
  interest: string[];
  message: string;
  source: string;
  status: LeadStatus;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  created_at: string;
  updated_at: string;
}

export interface Activity {
  id: string;
  lead_id: string;
  actor_id: string | null;
  actor_name: string | null;
  activity_type: "note" | "status_change" | "email_sent" | "call" | "meeting";
  payload: Record<string, unknown>;
  created_at: string;
}

export interface LeadStats {
  new_last_7_days: number;
  open_leads: number;
  won_last_30_days: number;
}

// ----- Endpoints -----

export const adminApi = {
  // Auth / me
  me: () => request<User>("/auth/me"),
  login: (email: string, password: string) =>
    fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),

  // Leads
  listLeads: () => request<{ leads: Lead[] }>("/leads/"),
  getLead: (id: string) => request<Lead>(`/leads/${id}`),
  listLeadActivities: (id: string) =>
    request<{ activities: Activity[] }>(`/leads/${id}/activities`),
  recentActivities: () =>
    request<{ activities: Activity[] }>(`/leads/activities/recent`),
  leadStats: () => request<LeadStats>(`/leads/stats`),
  updateLeadStatus: (id: string, status: LeadStatus, note?: string) =>
    request<void>(`/leads/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, note: note ?? "" }),
    }),
  addLeadNote: (id: string, note: string) =>
    request<void>(`/leads/${id}/notes`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),

  // Users
  listUsers: () => request<{ users: User[] }>("/auth/users"),
  createUser: (input: { email: string; full_name: string; role: Role; password: string }) =>
    request<User>("/auth/users", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateUser: (id: string, patch: Partial<{ full_name: string; role: Role }>) =>
    request<void>(`/auth/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  disableUser: (id: string) =>
    request<void>(`/auth/users/${id}/disable`, { method: "POST" }),
  enableUser: (id: string) =>
    request<void>(`/auth/users/${id}/enable`, { method: "POST" }),

  // Customers (admin side of customer-api)
  listCustomers: () => request<{ customers: AdminCustomer[] }>("/customer/admin/customers"),
  getCustomer: (id: string) => request<AdminCustomer>(`/customer/admin/customers/${id}`),
  createCustomer: (input: Partial<AdminCustomer> & { slug: string; name: string }) =>
    request<{ id: string }>("/customer/admin/customers", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateCustomer: (id: string, patch: Partial<AdminCustomer>) =>
    request<void>(`/customer/admin/customers/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  listCustomerContacts: (id: string) =>
    request<{ contacts: CustomerContactRow[] }>(`/customer/admin/customers/${id}/contacts`),
  createCustomerContact: (
    id: string,
    input: { email: string; full_name: string; role: "owner" | "member"; password: string },
  ) =>
    request<{ id: string }>(`/customer/admin/customers/${id}/contacts`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  disableCustomerContact: (id: string, contactId: string) =>
    request<void>(`/customer/admin/customers/${id}/contacts/${contactId}/disable`, { method: "POST" }),
  enableCustomerContact: (id: string, contactId: string) =>
    request<void>(`/customer/admin/customers/${id}/contacts/${contactId}/enable`, { method: "POST" }),

  // Staff opens a ticket on behalf of a customer.
  createTicketForCustomer: (
    id: string,
    input: {
      subject: string;
      body: string;
      priority: "low" | "normal" | "high" | "urgent";
      related_service_slug?: string;
      opened_by_contact_id?: string;
      assign_to_self?: boolean;
    },
  ) =>
    request<{ id: string }>(`/customer/admin/customers/${id}/tickets`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  // Customer assets — domains
  listCustomerDomains: (id: string) =>
    request<{ domains: AdminDomain[] }>(`/customer/admin/customers/${id}/domains`),
  createCustomerDomain: (id: string, input: Partial<AdminDomain> & { domain: string }) =>
    request<{ id: string }>(`/customer/admin/customers/${id}/domains`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateCustomerDomain: (id: string, domainId: string, patch: Partial<AdminDomain>) =>
    request<void>(`/customer/admin/customers/${id}/domains/${domainId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteCustomerDomain: (id: string, domainId: string) =>
    request<void>(`/customer/admin/customers/${id}/domains/${domainId}`, { method: "DELETE" }),

  // Customer assets — SLA contracts
  listCustomerSLA: (id: string) =>
    request<{ sla_contracts: AdminSLA[] }>(`/customer/admin/customers/${id}/sla`),
  createCustomerSLA: (id: string, input: Partial<AdminSLA> & {
    service_slug: string; title: string; starts_on: string; ends_on: string;
  }) =>
    request<{ id: string }>(`/customer/admin/customers/${id}/sla`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateCustomerSLA: (id: string, slaId: string, patch: Partial<AdminSLA>) =>
    request<void>(`/customer/admin/customers/${id}/sla/${slaId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteCustomerSLA: (id: string, slaId: string) =>
    request<void>(`/customer/admin/customers/${id}/sla/${slaId}`, { method: "DELETE" }),

  // Admin tickets queue
  listAdminTickets: (status?: string) =>
    request<{ tickets: AdminTicket[] }>(`/customer/admin/tickets${status ? `?status=${status}` : ""}`),
  ticketStats: () => request<TicketStats>(`/customer/admin/tickets/stats`),
  getAdminTicket: (id: string) => request<AdminTicket>(`/customer/admin/tickets/${id}`),
  listAdminTicketMessages: (id: string) =>
    request<{ messages: AdminTicketMessage[] }>(`/customer/admin/tickets/${id}/messages`),
  addAdminTicketMessage: (id: string, body: string, internal: boolean) =>
    request<void>(`/customer/admin/tickets/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ body, internal }),
    }),
  updateAdminTicket: (
    id: string,
    patch: Partial<{ status: string; priority: string; assigned_to_user_id: string }>,
  ) =>
    request<void>(`/customer/admin/tickets/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  // Domain orders (reseller-api)
  listDomainOrders: (status?: string) =>
    request<{ orders: AdminDomainOrder[] }>(
      `/reseller/orders${status ? `?status=${encodeURIComponent(status)}` : ""}`,
    ),
  getDomainOrder: (id: string) => request<AdminDomainOrder>(`/reseller/orders/${id}`),
  createDomainOrder: (input: NewDomainOrder) =>
    request<AdminDomainOrder>("/reseller/orders", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateDomainOrder: (id: string, patch: Partial<{ status: string; registry_order_id: string; notes: string }>) =>
    request<AdminDomainOrder>(`/reseller/orders/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  placeDomainOrder: (id: string) =>
    request<AdminDomainOrder>(`/reseller/orders/${id}/place`, { method: "POST" }),

  // PDPA Data Subject Requests
  listDSRs: (status?: string) =>
    request<DSR[]>(`/privacy/dsr${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  getDSR: (id: string) => request<DSR>(`/privacy/dsr/${id}`),
  updateDSR: (id: string, patch: { status?: string; assigned_to?: string; response_notes?: string }) =>
    request<DSR>(`/privacy/dsr/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  // Blog posts (admin CRUD via cms-api)
  listAdminBlogPosts: () =>
    request<{ posts: AdminBlogPost[] }>("/cms/admin/blog"),
  getAdminBlogPost: (slug: string) =>
    request<AdminBlogPost>(`/cms/admin/blog/${slug}`),
  createBlogPost: (input: BlogPostWriteInput) =>
    request<AdminBlogPost>("/cms/admin/blog", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateBlogPost: (slug: string, input: Partial<BlogPostWriteInput>) =>
    request<AdminBlogPost>(`/cms/admin/blog/${slug}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  deleteBlogPost: (slug: string) =>
    request<{ status: string }>(`/cms/admin/blog/${slug}`, { method: "DELETE" }),

  // Modules (toggle architecture — see memories/feature_module_toggle_architecture.md).
  listModules: () => request<AdminModule[]>("/cms/admin/modules"),
  toggleModule: (key: string, enabled: boolean) =>
    request<AdminModule>(`/cms/admin/modules/${encodeURIComponent(key)}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),
};

export type ModuleArea = "public" | "portal" | "admin" | "api";

export interface AdminModule {
  key: string;
  area: ModuleArea;
  name_en: string;
  name_th: string;
  description: string | null;
  enabled: boolean;
  core: boolean;
  sort_order: number;
  updated_at: string;
  updated_by: string | null;
}

// ----- Customer / ticket admin types -----

export interface AdminCustomer {
  id: string;
  slug: string;
  name: string;
  industry: string | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
  account_manager_id: string | null;
  account_manager_name: string | null;
  account_manager_email: string | null;
  services_used: string[];
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CustomerContactRow {
  id: string;
  customer_id: string;
  email: string;
  full_name: string;
  role: "owner" | "member";
  last_login_at: string | null;
  disabled_at: string | null;
  created_at: string;
}

export interface AdminTicket {
  id: string;
  customer_id: string;
  customer_name?: string;
  opened_by_contact_id: string | null;
  opened_by_name: string | null;
  subject: string;
  status: "open" | "in_progress" | "waiting_customer" | "resolved" | "closed";
  priority: "low" | "normal" | "high" | "urgent";
  assigned_to_user_id: string | null;
  assigned_to_name: string | null;
  related_service_slug: string | null;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
}

export interface AdminTicketMessage {
  id: string;
  ticket_id: string;
  author_user_id: string | null;
  author_contact_id: string | null;
  author_name: string;
  author_kind: "staff" | "customer";
  body: string;
  internal: boolean;
  created_at: string;
}

export interface TicketStats {
  open: number;
  in_progress: number;
  waiting_customer: number;
  urgent_open: number;
}

export interface AdminDomain {
  id: string;
  customer_id: string;
  domain: string;
  registrar: string;
  expires_at: string | null;
  privacy_enabled: boolean;
  auto_renew: boolean;
  notes: string | null;
  last_dns_change_at: string | null;
}

export interface AdminSLA {
  id: string;
  customer_id: string;
  service_slug: string;
  title: string;
  starts_on: string;
  ends_on: string;
  target_uptime_pct: number;
  status: "draft" | "active" | "renewing" | "expired";
  notes: string | null;
}


export type DomainOrderStatus = "pending" | "quoted" | "approved" | "registered" | "active" | "rejected" | "cancelled" | "failed";

export interface AdminDomainOrder {
  id: string;
  sld: string;
  tld: string;
  fqdn: string;
  registry: "thnic" | "resellerclub";
  customer_id: string | null;
  lead_id: string | null;
  requested_by_user_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_company: string | null;
  years: number;
  privacy_enabled: boolean;
  status: DomainOrderStatus;
  registry_order_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewDomainOrder {
  sld: string;
  tld: string;
  registry: "thnic" | "resellerclub";
  customer_id?: string;
  lead_id?: string;
  contact_name: string;
  contact_email: string;
  contact_phone?: string;
  contact_company?: string;
  years: number;
  privacy_enabled: boolean;
  notes?: string;
}

export type DSRStatus = "pending" | "in_progress" | "completed" | "rejected" | "withdrawn";
export type DSRRequestType = "access" | "rectification" | "erasure" | "portability" | "objection" | "restrict";

export interface DSR {
  id: string;
  requester_email: string;
  requester_name: string;
  request_type: DSRRequestType;
  description: string | null;
  locale: string;
  status: DSRStatus;
  assigned_to: string | null;
  due_date: string;
  response_notes: string | null;
  fulfilled_at: string | null;
  created_at: string;
}

// Blog posts (admin — raw JSONB for both locales)
export interface AdminBlogPost {
  id: string;
  slug: string;
  title: { en: string; th?: string };
  excerpt: { en: string; th?: string };
  body_md: { en: string; th?: string };
  cover_image_url: string | null;
  author_id: string | null;
  tags: string[];
  is_published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BlogPostWriteInput {
  slug?: string;
  title_en?: string;
  title_th?: string;
  excerpt_en?: string;
  excerpt_th?: string;
  body_md_en?: string;
  body_md_th?: string;
  cover_image_url?: string | null;
  tags?: string[];
  is_published?: boolean;
  published_at?: string | null;
}
