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
    request<{ id: string }>(`/portal/tickets/${id}/messages`, {
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

  // ----- Recurring subscriptions (self-service) -----
  listSubscriptions: () => request<PortalSubscription[]>("/payment/portal/subscriptions"),
  cancelSubscription: (id: string) =>
    request<{ status: string; paid_through: string }>(
      `/payment/portal/subscriptions/${id}/cancel`,
      { method: "POST" },
    ),

  // ----- Billing & payments -----
  listInvoices: () => request<PortalInvoiceSummary[]>("/payment/portal/invoices"),
  getInvoice: (id: string) => request<PortalInvoiceFull>(`/payment/portal/invoices/${id}`),
  initPayment: (invoiceId: string, method: PortalPaymentMethod) =>
    request<PortalInitPaymentResp>(`/payment/portal/invoices/${invoiceId}/pay`, {
      method: "POST",
      body: JSON.stringify({ method }),
    }),
  uploadSlip: (paymentId: string, input: PortalSlipInput) =>
    request<{ status: string }>(`/payment/portal/payments/${paymentId}/slip`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  uploadSlipFile: async (paymentId: string, file: File) => {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "/api";
    const t = sessionStorage.getItem("f2_portal_access_token");
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${apiBase}/payment/portal/payments/${paymentId}/slip-file`, {
      method: "POST",
      headers: t ? { Authorization: `Bearer ${t}` } : undefined,
      body: fd,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new HttpError(res.status, body);
    }
    return (await res.json()) as PortalSlipUploadResp;
  },
  capturePayPal: (paymentId: string) =>
    request<{ status: string }>(`/payment/portal/payments/${paymentId}/paypal/capture`, {
      method: "POST",
    }),
  publicPaymentMethods: async () => {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "/api";
    const res = await fetch(`${apiBase}/payment/methods`);
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as PortalPaymentMethodConfig[];
  },
  sandboxStatus: async () => {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "/api";
    const res = await fetch(`${apiBase}/payment/sandbox/status`);
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as PortalSandboxStatus;
  },

  // ----- Tax-invoice billing profile (customer self-service) -----
  getBillingProfile: () => request<PortalBillingProfile>("/payment/portal/billing-profile"),
  upsertBillingProfile: (input: PortalBillingProfile) =>
    request<PortalBillingProfile>("/payment/portal/billing-profile", {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  invoicePDFPath: (id: string, docOverride?: "receipt" | "tax_invoice") =>
    docOverride
      ? `/payment/portal/invoices/${id}/pdf?doc=${docOverride}`
      : `/payment/portal/invoices/${id}/pdf`,

  // Customer-visible suspensions: surface in the portal banner so they
  // see WHY services stopped working. Returns rows with status=active
  // only — that's enough to flag the situation. Re-uses the admin
  // list endpoint shape with portal-side auth.
  listMySuspensions: () =>
    request<PortalSuspension[]>("/payment/portal/suspensions"),

  // Projects & Checklists — read-only view of what F2 is doing for this
  // customer (audit checklists, weekly maintenance, progress). Wired to
  // checklist-api's /portal/* group which gates on aud=customer + customer_id.
  listMyProjects: () =>
    request<{ projects: PortalProject[] }>("/checklists/portal/projects"),
  getMyProjectBoard: (id: string) =>
    request<PortalProjectBoard>(`/checklists/portal/projects/${id}/board`),
  getMyProjectProgress: (id: string) =>
    request<PortalProjectProgress>(`/checklists/portal/projects/${id}/progress`),
};

// ── Projects & Checklists (portal) ──────────────────────────────────────

export interface PortalProject {
  id: string;
  client_name: string;
  name: string;
  status: "active" | "paused" | "closed";
  start_date: string | null;
  end_date: string | null;
  customer_id: string | null;
  customer_name: string | null;
  visible_to_customer: boolean;
  created_at: string;
  updated_at: string;
  done_count?: number;
  total_count?: number;
  fail_count?: number;
}

export type PortalItemStatus = "pending" | "pass" | "fail" | "na";

export interface PortalProjectItem {
  id: string;
  project_module_id: string;
  text_en: string;
  text_th: string;
  sort_order: number;
  required: boolean;
  status: PortalItemStatus;
  note: string | null;
  photo_url: string | null;
  checked_at: string | null;
}

export interface PortalProjectModule {
  id: string;
  project_id: string;
  code: string;
  name_en: string;
  name_th: string;
  position: number;
  items: PortalProjectItem[];
}

export interface PortalProjectBoard {
  project: PortalProject;
  modules: PortalProjectModule[];
}

export interface PortalProjectProgress {
  modules: Array<{
    project_module_id: string;
    code: string;
    name_en: string;
    name_th: string;
    total: number;
    done: number;
    fail: number;
    na: number;
    pending: number;
  }>;
  totals: { total: number; done: number; pass: number; fail: number; na: number; pending: number };
}

export interface PortalSuspension {
  id: string;
  invoice_id: string;
  invoice_number: string;
  product_type: string;
  suspended_at: string;
}

export interface PortalBillingProfile {
  customer_id?: string;
  legal_name: string;
  tax_id?: string;
  branch_code: string;
  address_line1?: string;
  address_line2?: string;
  subdistrict?: string;
  district?: string;
  province?: string;
  postal_code?: string;
  country: string;
  billing_email?: string;
  notes?: string;
}

export interface PortalSandboxStatus {
  // method → mode for every method known to the server
  methods: Record<string, "sandbox" | "production">;
  // true when ANY method is in sandbox — drives banner visibility
  any_sandbox: boolean;
  paypal_mode: "sandbox" | "live";
  paypal_configured: boolean;
}

import type {
  Invoice as _Invoice,
  Payment as _Payment,
  InvoiceItem as _InvoiceItem,
  PaymentMethod,
  PaymentMethodConfig,
  InitPaymentResp,
} from "@/lib/payment-types";

export type PortalInvoiceSummary = _Invoice;
export type PortalInvoiceFull = _Invoice & { items: _InvoiceItem[]; payments: _Payment[] };
export interface PortalSubscription {
  id: string;
  title: string;
  product_type: "hosting" | "sla" | "msp" | "custom";
  billing_cycle: string;
  amount_cents: number;
  currency: "THB" | "USD";
  status: "active" | "paused" | "cancelled";
  starts_on: string;
  ends_on: string | null;
  next_billing_at: string;
}
export type PortalPaymentMethod = PaymentMethod;
export type PortalPaymentMethodConfig = PaymentMethodConfig;
export type PortalInitPaymentResp = InitPaymentResp;
export interface PortalSlipInput {
  slip_url: string;
  bank_ref?: string;
  transferred_at?: string;
}
export interface PortalSlipUploadResp {
  file_id: string;
  slip_url: string;
  size_bytes: number;
  mime_type: string;
  status: "awaiting_verification";
}

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
