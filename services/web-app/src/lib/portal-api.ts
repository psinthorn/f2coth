// Client-side API helper for /portal/*.
// Uses customer-side auth tokens stored under f2_portal_* keys
// (separate from staff f2_access_* so a staff session in another tab
// doesn't bleed into the portal).

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/api";

export class HttpError extends Error {
  constructor(public status: number, public body: string) {
    super(`HTTP ${status}: ${body}`);
  }
}

const KEY_ACCESS = "f2_portal_access_token";
const KEY_REFRESH = "f2_portal_refresh_token";
const KEY_CONTACT = "f2_portal_contact";

function token(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(KEY_ACCESS);
}

function refreshTok(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(KEY_REFRESH);
}

export function clearPortalAuth() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(KEY_ACCESS);
  sessionStorage.removeItem(KEY_REFRESH);
  sessionStorage.removeItem(KEY_CONTACT);
}

export function setPortalAuth(access: string, refresh: string, contact: unknown) {
  sessionStorage.setItem(KEY_ACCESS, access);
  sessionStorage.setItem(KEY_REFRESH, refresh);
  sessionStorage.setItem(KEY_CONTACT, JSON.stringify(contact));
}

export function redirectToPortalLogin(returnTo?: string) {
  if (typeof window === "undefined") return;
  const next = returnTo ?? window.location.pathname + window.location.search;
  window.location.href = `/portal/login?next=${encodeURIComponent(next)}`;
}

async function attemptRefresh(): Promise<boolean> {
  const rt = refreshTok();
  if (!rt) return false;
  try {
    const res = await fetch(`${API_BASE}/auth/customer/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: rt }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    setPortalAuth(data.access_token, data.refresh_token, data.contact);
    return true;
  } catch {
    return false;
  }
}

async function request<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
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
    if (await attemptRefresh()) return request<T>(path, init, true);
    clearPortalAuth();
    redirectToPortalLogin();
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

export type TicketStatus = "open" | "in_progress" | "waiting_customer" | "resolved" | "closed";
export type TicketPriority = "low" | "normal" | "high" | "urgent";

export interface PortalContact {
  id: string;
  customer_id: string;
  email: string;
  full_name: string;
  role: "owner" | "member";
  last_login_at: string | null;
  disabled_at: string | null;
  created_at: string;
}

export interface PortalCustomer {
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
}

export interface PortalTicket {
  id: string;
  customer_id: string;
  customer_name?: string;
  opened_by_contact_id: string | null;
  opened_by_name: string | null;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  assigned_to_user_id: string | null;
  assigned_to_name: string | null;
  related_service_slug: string | null;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
}

export interface PortalMessage {
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

// ----- Endpoints -----

export const portalApi = {
  login: async (email: string, password: string) => {
    const res = await fetch(`${API_BASE}/auth/customer/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new HttpError(res.status, await res.text());
    const data = await res.json();
    setPortalAuth(data.access_token, data.refresh_token, data.contact);
    return data.contact as PortalContact;
  },
  logout: async () => {
    const rt = refreshTok();
    if (rt) {
      await fetch(`${API_BASE}/auth/customer/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: rt }),
      }).catch(() => {});
    }
    clearPortalAuth();
  },

  me: () => request<{ contact: PortalContact; customer: PortalCustomer }>("/portal/me"),

  listTickets: () => request<{ tickets: PortalTicket[] }>("/portal/tickets"),
  getTicket: (id: string) => request<PortalTicket>(`/portal/tickets/${id}`),
  createTicket: (input: { subject: string; body: string; priority: TicketPriority; related_service_slug?: string }) =>
    request<{ id: string }>("/portal/tickets", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  listMessages: (id: string) => request<{ messages: PortalMessage[] }>(`/portal/tickets/${id}/messages`),
  addMessage: (id: string, body: string) =>
    request<void>(`/portal/tickets/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }),
  setStatus: (id: string, status: "resolved" | "open") =>
    request<void>(`/portal/tickets/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),

  listDomains: () => request<{ domains: PortalDomain[] }>("/portal/domains"),
  listSLA: () => request<{ sla_contracts: PortalSLA[] }>("/portal/sla"),

  listDomainOrders: () =>
    request<{ orders: PortalDomainOrder[] }>("/portal/domains/orders"),
  createDomainOrder: (input: NewPortalDomainOrder) =>
    request<PortalDomainOrder>("/portal/domains/orders", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  // Availability search uses the public reseller-api endpoint (no auth needed).
  checkAvailability: async (sld: string, tlds: string[]) => {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "/api";
    const res = await fetch(`${apiBase}/reseller/availability`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sld, tlds }),
    });
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as { results: AvailabilityResult[] };
  },
};

export interface PortalDomain {
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

export type DomainOrderStatus =
  | "pending" | "quoted" | "approved" | "registered"
  | "active" | "rejected" | "cancelled" | "failed";

export interface PortalDomainOrder {
  id: string;
  sld: string;
  tld: string;
  fqdn: string;
  registry: "thnic" | "resellerclub";
  years: number;
  privacy_enabled: boolean;
  status: DomainOrderStatus;
  registry_order_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewPortalDomainOrder {
  sld: string;
  tld: string;
  registry: "thnic" | "resellerclub";
  contact_name: string;
  contact_email: string;
  contact_phone?: string;
  contact_company?: string;
  years: number;
  privacy_enabled: boolean;
  notes?: string;
}

export interface AvailabilityResult {
  fqdn: string;
  tld: string;
  available: boolean;
  classification: "available" | "registered" | "reserved" | "premium" | "manual" | "unknown";
  source: string;
  cached: boolean;
}

export interface PortalSLA {
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
