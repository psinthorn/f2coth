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

// "Remember me" persists the session in localStorage (survives browser close);
// otherwise sessionStorage (cleared when the tab closes). Reads check both;
// the store currently holding the token is the "active" one, so a token refresh
// preserves whichever the user chose at login.
function activeStore(): Storage | null {
  if (typeof window === "undefined") return null;
  if (localStorage.getItem(KEY_ACCESS)) return localStorage;
  return sessionStorage;
}

function token(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(KEY_ACCESS) ?? sessionStorage.getItem(KEY_ACCESS);
}

function refreshTok(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(KEY_REFRESH) ?? sessionStorage.getItem(KEY_REFRESH);
}

export function clearPortalAuth() {
  if (typeof window === "undefined") return;
  for (const s of [localStorage, sessionStorage]) {
    s.removeItem(KEY_ACCESS); s.removeItem(KEY_REFRESH); s.removeItem(KEY_CONTACT);
  }
}

// remember=true → localStorage; false → sessionStorage; undefined → keep the
// current active store (used by refresh / switch-org so they don't downgrade
// a "remember me" session).
export function setPortalAuth(access: string, refresh: string, contact: unknown, remember?: boolean) {
  if (typeof window === "undefined") return;
  const store = remember === undefined ? (activeStore() ?? sessionStorage) : (remember ? localStorage : sessionStorage);
  const other = store === localStorage ? sessionStorage : localStorage;
  other.removeItem(KEY_ACCESS); other.removeItem(KEY_REFRESH); other.removeItem(KEY_CONTACT);
  store.setItem(KEY_ACCESS, access);
  store.setItem(KEY_REFRESH, refresh);
  store.setItem(KEY_CONTACT, JSON.stringify(contact));
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
    // Server errors are JSON {"error":"..."}; surface that message (falls back
    // to raw body) so forbidden / last-owner / duplicate toasts read cleanly.
    const body = await res.text();
    let msg = body;
    try { const j = JSON.parse(body); if (j?.error) msg = j.error; } catch { /* keep raw */ }
    throw new HttpError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ----- Types -----

export type TicketStatus = "open" | "in_progress" | "waiting_customer" | "resolved" | "closed";
export type TicketPriority = "low" | "normal" | "high" | "urgent";

export type OrgRole = "owner" | "admin" | "billing" | "member" | "viewer";

export interface PortalMember {
  contact_id: string;
  email: string;
  full_name: string;
  role: OrgRole;
  is_primary: boolean;
  disabled: boolean;
  verified: boolean;
  pending: boolean;
  last_login_at: string | null;
  invited_at: string | null;
}

export interface PortalContact {
  id: string;
  customer_id: string;
  email: string;
  full_name: string;
  role: OrgRole;
  last_login_at: string | null;
  disabled_at: string | null;
  created_at: string;
  // Account lifecycle (migration 071).
  email_verified_at?: string | null;
  must_change_password?: boolean;
  phone?: string | null;
  job_title?: string | null;
  is_primary?: boolean;
  mfa_enabled?: boolean;
}

export interface PortalMembership {
  customer_id: string;
  customer_name: string;
  role: "owner" | "member";
  is_primary: boolean;
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
  // Resolution write-up. Server only populates this once the ticket is
  // resolved/closed AND staff enabled sharing; otherwise it's an empty string.
  solution?: string;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
}

export interface PortalTicketLine {
  id: string;
  description_en: string;
  description_th?: string | null;
  unit: string;
  quantity: number;
  unit_price_cents: number;
  covered: boolean;
  amount_cents: number;
  currency: "THB" | "USD";
}
export interface PortalTicketBilling {
  ticket_id: string;
  billing_status: "none" | "covered" | "billable";
  currency: "THB" | "USD";
  lines: PortalTicketLine[];
  subtotal_cents: number;
  vat_rate_bp: number;
  vat_cents: number;
  total_cents: number;
  covered_by_title?: string | null;
  invoice_id?: string | null;
  invoice_number?: string | null;
  invoice_status?: string | null;
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
  // Returns { mfaRequired: true, mfaToken } when the account has MFA enabled —
  // the caller then collects a code and calls mfaVerify. Otherwise stores the
  // session and returns { contact }.
  login: async (email: string, password: string, remember = false): Promise<{ mfaRequired: boolean; mfaToken?: string; contact?: PortalContact }> => {
    const res = await fetch(`${API_BASE}/auth/customer/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new HttpError(res.status, await res.text());
    const data = await res.json();
    if (data.mfa_required) return { mfaRequired: true, mfaToken: data.mfa_token };
    setPortalAuth(data.access_token, data.refresh_token, data.contact, remember);
    return { mfaRequired: false, contact: data.contact as PortalContact };
  },
  // Complete the second factor with a TOTP code or a recovery code.
  mfaVerify: async (mfaToken: string, input: { code?: string; recovery_code?: string }, remember = false) => {
    const res = await fetch(`${API_BASE}/auth/customer/mfa/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mfa_token: mfaToken, ...input }),
    });
    if (!res.ok) throw new HttpError(res.status, await res.text());
    const data = await res.json();
    setPortalAuth(data.access_token, data.refresh_token, data.contact, remember);
    return data.contact as PortalContact;
  },
  // ── MFA enrolment (authenticated) ──
  mfaSetup: () => request<{ secret: string; otpauth_uri: string }>("/auth/customer/mfa/setup", { method: "POST" }),
  mfaEnable: (code: string) => request<{ recovery_codes: string[] }>("/auth/customer/mfa/enable", { method: "POST", body: JSON.stringify({ code }) }),
  mfaDisable: (code: string) => request<void>("/auth/customer/mfa/disable", { method: "POST", body: JSON.stringify({ code }) }),
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

  me: () =>
    request<{ contact: PortalContact; customer: PortalCustomer; memberships: PortalMembership[]; mfa_setup_required?: boolean }>(
      "/portal/me",
    ),

  // Enumeration-safe on the server (always 200); no auth required.
  requestVerificationLink: (email: string) =>
    fetch(`${API_BASE}/auth/customer/request-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, purpose: "verification" }),
    }).then(() => {}),

  updateProfile: (input: { full_name?: string; phone?: string; job_title?: string; locale?: string }) =>
    request<void>("/portal/me", { method: "PATCH", body: JSON.stringify(input) }),

  // Goes through request() so an expired access token is transparently
  // refreshed. The server revokes all sessions on success, so the caller must
  // re-authenticate afterwards.
  changePassword: (current_password: string, new_password: string) =>
    request<void>("/auth/customer/change-password", {
      method: "POST",
      body: JSON.stringify({ current_password, new_password }),
    }),

  // Re-mint the access token scoped to another org the contact belongs to.
  // The server also binds the new active org to the refresh token, so a later
  // transparent refresh preserves the switch.
  switchOrg: async (customer_id: string) => {
    const data = await request<{ access_token: string; customer_id: string; role: string }>(
      "/auth/customer/switch-org",
      { method: "POST", body: JSON.stringify({ customer_id }) },
    );
    // Swap only the access token; keep it in whichever store the session uses.
    if (typeof window !== "undefined") (activeStore() ?? sessionStorage).setItem(KEY_ACCESS, data.access_token);
    return data;
  },

  // ── Team & Roles (org self-administration; Owner/Admin only) ──
  listMembers: () => request<{ members: PortalMember[] }>("/portal/members"),
  inviteMember: (input: { email: string; full_name: string; role: OrgRole }) =>
    request<{ contact_id: string; linked: boolean }>("/portal/members/invite", { method: "POST", body: JSON.stringify(input) }),
  setMemberRole: (contactId: string, role: OrgRole) =>
    request<void>(`/portal/members/${contactId}/role`, { method: "PATCH", body: JSON.stringify({ role }) }),
  setMemberStatus: (contactId: string, disabled: boolean) =>
    request<void>(`/portal/members/${contactId}/status`, { method: "PATCH", body: JSON.stringify({ disabled }) }),
  removeMember: (contactId: string) =>
    request<void>(`/portal/members/${contactId}`, { method: "DELETE" }),

  getTicketBilling: (id: string) => request<PortalTicketBilling>(`/portal/tickets/${id}/billing`),

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

export interface PortalProjectSubsection {
  id: string;
  project_module_id: string;
  name_en: string;
  name_th: string;
  sort_order: number;
  items: PortalProjectItem[];
}

export interface PortalProjectModule {
  id: string;
  project_id: string;
  code: string;
  name_en: string;
  name_th: string;
  position: number;
  subsections: PortalProjectSubsection[];
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
