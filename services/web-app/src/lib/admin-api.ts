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

export interface SMTPSettings {
  host: string;
  port: number;
  username: string;
  password: string;
  from_address: string;
  tls_mode: "none" | "starttls" | "tls";
}

export const adminApi = {
  // SMTP settings (notification-api admin routes)
  getSMTP: () => request<SMTPSettings>("/notifications/admin/smtp"),
  updateSMTP: (s: SMTPSettings) =>
    request<void>("/notifications/admin/smtp", { method: "PUT", body: JSON.stringify(s) }),
  testSMTP: (to: string) =>
    request<{ status: string; to: string }>("/notifications/admin/smtp/test", {
      method: "POST", body: JSON.stringify({ to }),
    }),

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
  updateCustomerShowcase: (id: string, patch: CustomerShowcasePatch) =>
    request<AdminCustomer>(`/customer/admin/customers/${id}/showcase`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  listCustomerShowcaseAudit: (id: string) =>
    request<{ entries: CustomerShowcaseAuditEntry[] }>(
      `/customer/admin/customers/${id}/showcase/audit`,
    ),
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
    request<{ id: string }>(`/customer/admin/tickets/${id}/messages`, {
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

  // Services (admin CRUD via cms-api)
  listAdminServices: () =>
    request<{ services: AdminService[] }>("/cms/admin/services"),
  getAdminService: (slug: string) =>
    request<AdminService>(`/cms/admin/services/${slug}`),
  createService: (input: ServiceWriteInput) =>
    request<AdminService>("/cms/admin/services", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateService: (slug: string, input: Partial<ServiceWriteInput>) =>
    request<AdminService>(`/cms/admin/services/${slug}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  deleteService: (slug: string) =>
    request<{ status: string }>(`/cms/admin/services/${slug}`, { method: "DELETE" }),

  // Case studies (admin CRUD via cms-api)
  listAdminCaseStudies: () =>
    request<{ case_studies: AdminCaseStudy[] }>("/cms/admin/case-studies"),
  getAdminCaseStudy: (slug: string) =>
    request<AdminCaseStudy>(`/cms/admin/case-studies/${slug}`),
  createCaseStudy: (input: CaseStudyWriteInput) =>
    request<AdminCaseStudy>("/cms/admin/case-studies", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateCaseStudy: (slug: string, input: Partial<CaseStudyWriteInput>) =>
    request<AdminCaseStudy>(`/cms/admin/case-studies/${slug}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  deleteCaseStudy: (slug: string) =>
    request<{ status: string }>(`/cms/admin/case-studies/${slug}`, { method: "DELETE" }),

  // Global app mode (production / trial / maintenance)
  getAppMode: () => request<AdminAppMode>("/cms/admin/app-mode"),
  setAppMode: (input: { mode: AppMode; message_en: string; message_th: string }) =>
    request<{ status: string } & AdminAppMode>("/cms/admin/app-mode", {
      method: "PUT",
      body: JSON.stringify(input),
    }),

  // Home page content (bulk upsert of bilingual copy blocks)
  listAdminHomeContent: () =>
    request<{ items: AdminHomeContentItem[] }>("/cms/admin/home"),
  upsertHomeContent: (items: AdminHomeContentItem[]) =>
    request<{ status: string; count: number }>("/cms/admin/home", {
      method: "PUT",
      body: JSON.stringify({ items }),
    }),

  // Static pages (admin CRUD via cms-api)
  listAdminPages: () =>
    request<{ pages: AdminPage[] }>("/cms/admin/pages"),
  getAdminPage: (slug: string) =>
    request<AdminPage>(`/cms/admin/pages/${slug}`),
  createPage: (input: PageWriteInput) =>
    request<AdminPage>("/cms/admin/pages", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updatePage: (slug: string, input: Partial<PageWriteInput>) =>
    request<AdminPage>(`/cms/admin/pages/${slug}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  deletePage: (slug: string) =>
    request<{ status: string }>(`/cms/admin/pages/${slug}`, { method: "DELETE" }),

  // Modules (toggle architecture — see memories/feature_module_toggle_architecture.md).
  listModules: () => request<AdminModule[]>("/cms/admin/modules"),
  toggleModule: (key: string, enabled: boolean) =>
    request<AdminModule>(`/cms/admin/modules/${encodeURIComponent(key)}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),
  listModuleAudit: (key: string) =>
    request<ModuleAuditEntry[]>(`/cms/admin/modules/${encodeURIComponent(key)}/audit`),

  // ----- Billing & payments -----
  listInvoices: (params?: { status?: string; customer_id?: string }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.customer_id) q.set("customer_id", params.customer_id);
    const qs = q.toString();
    return request<AdminInvoice[]>(`/payment/admin/invoices${qs ? "?" + qs : ""}`);
  },
  getInvoice: (id: string) => request<AdminInvoiceFull>(`/payment/admin/invoices/${id}`),
  createInvoice: (input: AdminCreateInvoiceInput) =>
    request<AdminInvoiceFull>("/payment/admin/invoices", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateInvoice: (id: string, input: AdminUpdateInvoiceInput) =>
    request<AdminInvoiceFull>(`/payment/admin/invoices/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  issueInvoice: (id: string) =>
    request<AdminInvoiceFull>(`/payment/admin/invoices/${id}/issue`, { method: "POST" }),
  voidInvoice: (id: string, reason: string) =>
    request<AdminInvoiceFull>(`/payment/admin/invoices/${id}/void`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  listPayments: (params?: { status?: string; method?: string }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.method) q.set("method", params.method);
    const qs = q.toString();
    return request<AdminPaymentRow[]>(`/payment/admin/payments${qs ? "?" + qs : ""}`);
  },
  verifyPayment: (id: string) =>
    request<{ status: string }>(`/payment/admin/payments/${id}/verify`, { method: "POST" }),
  rejectPayment: (id: string, reason: string) =>
    request<{ status: string }>(`/payment/admin/payments/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  listPaymentMethods: () =>
    request<AdminPaymentMethodConfig[]>("/payment/admin/methods"),
  updatePaymentMethod: (method: string, input: Partial<AdminPaymentMethodConfig>) =>
    request<{ status: string }>(`/payment/admin/methods/${method}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),

  // ----- Per-payment-method sandbox helpers -----
  // The global mode toggle is gone — each method now carries its own
  // mode in payment_methods_config.mode (see updatePaymentMethod below).
  // Sandbox endpoints validate the relevant method's mode per call.
  sandboxInvoices: () => request<SandboxInvoiceRow[]>("/payment/admin/sandbox/invoices"),
  sandboxPayments: () => request<SandboxPaymentRow[]>("/payment/admin/sandbox/payments"),
  sandboxSeed: () =>
    request<SandboxSeedResp>("/payment/admin/sandbox/seed", { method: "POST" }),
  sandboxCompletePayment: (id: string) =>
    request<{ status: string }>(`/payment/admin/sandbox/payments/${id}/complete`, { method: "POST" }),
  sandboxSimulateWebhook: (id: string) =>
    request<SandboxSimulateResp>(`/payment/admin/sandbox/payments/${id}/simulate-webhook`, { method: "POST" }),
  sandboxPurge: () =>
    request<{ deleted: number }>("/payment/admin/sandbox/purge", { method: "POST" }),

  // ----- Billing profile (Thai tax-invoice metadata) -----
  getBillingProfile: (customerID: string) =>
    request<BillingProfile>(`/payment/admin/customers/${customerID}/billing-profile`),
  upsertBillingProfile: (customerID: string, input: BillingProfile) =>
    request<BillingProfile>(`/payment/admin/customers/${customerID}/billing-profile`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),

  // ----- Subscriptions (recurring billing) -----
  listSubscriptions: (params?: { status?: string }) => {
    const q = params?.status ? `?status=${params.status}` : "";
    return request<AdminSubscription[]>(`/payment/admin/subscriptions${q}`);
  },
  createSubscription: (input: AdminSubscriptionInput) =>
    request<{ id: string }>("/payment/admin/subscriptions", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  setSubscriptionStatus: (id: string, status: "active" | "paused" | "cancelled") =>
    request<{ status: string }>(`/payment/admin/subscriptions/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),

  // ----- Refunds -----
  listRefunds: (params?: { status?: string }) => {
    const q = params?.status ? `?status=${params.status}` : "";
    return request<AdminRefund[]>(`/payment/admin/refunds${q}`);
  },
  createRefund: (input: AdminRefundInput) =>
    request<AdminRefundResp>("/payment/admin/refunds", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  // ----- Dashboard summary -----
  paymentDashboard: () =>
    request<PaymentDashboardSummary>("/payment/admin/dashboard/summary"),

  // ----- Product catalog (for subscription create form) -----
  paymentCatalog: (customerID?: string) => {
    const q = customerID ? `?customer_id=${customerID}` : "";
    return request<PaymentCatalog>(`/payment/admin/catalog${q}`);
  },

  // ----- Bank statement reconciliation -----
  listBankImports: () => request<BankImport[]>("/payment/admin/bank-imports"),
  getBankImport: (id: string) => request<BankImportFull>(`/payment/admin/bank-imports/${id}`),
  uploadBankImport: async (file: File, sourceName: string) => {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "/api";
    const t = sessionStorage.getItem("f2_access_token");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("source_name", sourceName);
    const res = await fetch(`${apiBase}/payment/admin/bank-imports`, {
      method: "POST",
      headers: t ? { Authorization: `Bearer ${t}` } : undefined,
      body: fd,
    });
    if (!res.ok) throw new HttpError(res.status, await res.text());
    return (await res.json()) as BankImportFull;
  },
  applyBankImport: (id: string) =>
    request<{ applied: number; import: BankImportFull }>(`/payment/admin/bank-imports/${id}/apply`, { method: "POST" }),

  // ----- Bulk invoice actions -----
  bulkIssueInvoices: (ids: string[]) =>
    request<BulkResp>("/payment/admin/invoices/bulk-issue", {
      method: "POST", body: JSON.stringify({ ids }),
    }),
  bulkVoidInvoices: (ids: string[], reason: string) =>
    request<BulkResp>("/payment/admin/invoices/bulk-void", {
      method: "POST", body: JSON.stringify({ ids, reason }),
    }),

  // ----- Webhook events -----
  listWebhookEvents: (params?: { provider?: string; processed?: string }) => {
    const q = new URLSearchParams();
    if (params?.provider) q.set("provider", params.provider);
    if (params?.processed) q.set("processed", params.processed);
    const qs = q.toString();
    return request<WebhookEvent[]>(`/payment/admin/webhooks${qs ? "?" + qs : ""}`);
  },
  getWebhookEvent: (id: string) =>
    request<WebhookEventDetail>(`/payment/admin/webhooks/${id}`),
  replayWebhookEvent: (id: string) =>
    request<{ status: string }>(`/payment/admin/webhooks/${id}/replay`, { method: "POST" }),

  // Disputes (driven by PayPal CUSTOMER.DISPUTE.* webhooks)
  listDisputes: (params?: { status?: string }) => {
    const q = params?.status ? `?status=${params.status}` : "";
    return request<AdminDispute[]>(`/payment/admin/disputes${q}`);
  },

  // Server-rendered PDF — returns a path the caller can hit with the
  // auth header to download a binary. Frontend uses fetch+blob since
  // <a download> can't carry Authorization headers.
  invoicePDFPath: (id: string) => `/payment/admin/invoices/${id}/pdf`,

  // ----- Analytics -----
  analyticsMRR: () => request<MRRPoint[]>("/payment/admin/analytics/mrr"),
  analyticsAging: () => request<ARAgingResp>("/payment/admin/analytics/aging"),
  analyticsChurn: () => request<ChurnPoint[]>("/payment/admin/analytics/churn"),

  // ----- Service suspensions (driven by dunning scheduler) -----
  listSuspensions: (params?: { status?: string }) => {
    const q = params?.status ? `?status=${params.status}` : "";
    return request<AdminSuspension[]>(`/payment/admin/suspensions${q}`);
  },
  restoreSuspension: (id: string) =>
    request<{ status: string }>(`/payment/admin/suspensions/${id}/restore`, { method: "POST" }),
  overrideSuspension: (id: string, reason: string) =>
    request<{ status: string }>(`/payment/admin/suspensions/${id}/override`, {
      method: "POST", body: JSON.stringify({ reason }),
    }),

  // AI orchestrator (migration 050, ai-orchestrator-api on :8009)
  listAIRouting: () =>
    request<{ routes: AIRoutingRow[] }>("/ai/admin/routing"),
  updateAIRoute: (id: string, patch: AIRoutingPatch) =>
    request<void>(`/ai/admin/routing/${id}`, {
      method: "PATCH", body: JSON.stringify(patch),
    }),
  getAIUsageSummary: () =>
    request<AIUsageSummary>("/ai/admin/usage"),
  listAIUsageEntries: (params?: { limit?: number; task_type?: string }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.task_type) q.set("task_type", params.task_type);
    const qs = q.toString();
    return request<{ entries: AIUsageEntry[] }>(
      `/ai/admin/usage/entries${qs ? `?${qs}` : ""}`,
    );
  },
};

// -------------------- AI orchestrator types --------------------

export type AIProvider = "anthropic" | "ollama" | "openai" | "voyage";
export type AITier = "primary" | "fallback" | "batch";

export interface AIRoutingRow {
  id: string;
  task_type: string;
  tier: AITier;
  provider: AIProvider;
  model: string;
  max_tokens_in: number | null;
  max_tokens_out: number | null;
  enabled: boolean;
  notes: string | null;
  updated_at: string;
}

export interface AIRoutingPatch {
  provider?: AIProvider;
  model?: string;
  max_tokens_in?: number | null;
  max_tokens_out?: number | null;
  enabled?: boolean;
  notes?: string | null;
}

export interface AIUsageSummary {
  mtd_cost_usd: number;
  today_cost_usd: number;
  budget_usd: number;
  pct_used: number;
  calls_mtd: number;
  by_task: Array<{
    task_type: string;
    calls: number;
    tokens_in: number;
    tokens_out: number;
    cost_usd: number;
  }>;
  by_provider: Array<{
    provider: string;
    calls: number;
    tokens_in: number;
    tokens_out: number;
    cost_usd: number;
  }>;
}

export interface AIUsageEntry {
  at: string;
  task_type: string;
  provider: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  latency_ms: number;
  error?: string | null;
}

export interface AdminSuspension {
  id: string;
  invoice_id: string;
  invoice_number: string;
  customer_id: string;
  customer_name: string;
  product_type: "subscription" | "sla" | "hosting" | "msp" | "custom";
  product_ref: string | null;
  previous_state: string | null;
  status: "active" | "restored" | "overridden";
  reason: string | null;
  suspended_at: string;
  restored_at: string | null;
}

export interface MRRPoint {
  month: string;             // YYYY-MM
  all_revenue_cents: number;
  sub_revenue_cents: number;
  payments_count: number;
  sub_payments_count: number;
}
export interface ARAgingBucket {
  label: "current" | "1_30" | "31_60" | "61_90" | "90_plus";
  cents: number;
  count: number;
}
export interface ARAgingResp {
  as_of: string;
  buckets: ARAgingBucket[];
}
export interface ChurnPoint {
  month: string;
  cancelled_count: number;
  active_at_start: number;
  churn_rate_percent: number;
}

export interface AdminDispute {
  id: string;
  payment_id: string;
  invoice_id: string;
  provider: string;
  provider_dispute_id: string;
  reason: string | null;
  status: "open" | "waiting_buyer" | "waiting_seller" | "under_review" | "resolved" | "closed";
  outcome: string | null;
  amount_cents: number;
  currency: "THB" | "USD";
  seller_response_due: string | null;
  opened_at: string;
  resolved_at: string | null;
  payment_number: string;
  invoice_number: string;
  customer_name: string;
}

export interface BulkResp {
  succeeded: number;
  skipped: number;
  errors?: string[];
}

export interface WebhookEvent {
  id: string;
  provider: string;
  event_id: string;
  event_type: string;
  signature_ok: boolean;
  processed_at: string | null;
  payment_id: string | null;
  payment_number: string | null;
  invoice_id: string | null;
  error: string | null;
  received_at: string;
}

export interface WebhookEventDetail extends Omit<WebhookEvent, "payment_number" | "invoice_id"> {
  payload: string;
}

export interface PaymentCatalog {
  hosting: CatalogHosting[];
  sla: CatalogSLA[];
}
export interface CatalogHosting {
  id: string;
  slug: string;
  name_en: string;
  name_th: string;
  monthly_cents: number;
  annually_cents: number;
}
export interface CatalogSLA {
  id: string;
  title: string;
  starts_on: string;
  ends_on: string;
  status: string;
}

export interface BankImport {
  id: string;
  source_name: string | null;
  raw_filename: string | null;
  status: "pending" | "applied" | "discarded";
  parsed_rows: number;
  matched_rows: number;
  applied_rows: number;
  created_at: string;
  applied_at: string | null;
}

export interface BankImportRow {
  id: string;
  line_number: number;
  transferred_at: string;
  amount_cents: number;
  bank_ref: string | null;
  description: string | null;
  match_status: "unmatched" | "proposed" | "applied" | "skipped";
  matched_payment_id: string | null;
  payment_number: string | null;
  invoice_id: string | null;
  invoice_number: string | null;
  customer_name: string | null;
}

export interface BankImportFull extends BankImport {
  rows: BankImportRow[];
}

export interface BillingProfile {
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

export interface AdminSubscription {
  id: string;
  customer_id: string;
  customer_name?: string;
  title: string;
  product_type: "hosting" | "sla" | "msp" | "custom";
  product_ref: string | null;
  billing_cycle: "monthly" | "quarterly" | "annually";
  amount_cents: number;
  currency: "THB" | "USD";
  status: "active" | "paused" | "cancelled";
  starts_on: string;
  ends_on: string | null;
  last_billed_on: string | null;
  next_billing_at: string;
  created_at: string;
}

export interface AdminSubscriptionInput {
  customer_id: string;
  title: string;
  product_type: "hosting" | "sla" | "msp" | "custom";
  product_ref?: string;
  billing_cycle: "monthly" | "quarterly" | "annually";
  amount_cents: number;
  currency: "THB" | "USD";
  starts_on: string;
  ends_on?: string;
}

export interface AdminRefund {
  id: string;
  refund_number: string;
  payment_id: string;
  payment_number: string;
  invoice_id: string;
  invoice_number: string;
  customer_name: string;
  method: string;
  amount_cents: number;
  currency: "THB" | "USD";
  reason: string;
  status: "pending" | "completed" | "failed";
  provider_refund_id: string | null;
  bank_ref: string | null;
  proof_url: string | null;
  completed_at: string | null;
  failure_reason: string | null;
  created_at: string;
}

export interface AdminRefundInput {
  payment_id: string;
  amount_cents?: number;
  reason: string;
  bank_ref?: string;
  proof_url?: string;
}

export interface AdminRefundResp {
  id: string;
  refund_number: string;
  status: string;
}

export interface PaymentDashboardSummary {
  outstanding_cents: number;
  outstanding_count: number;
  overdue_cents: number;
  overdue_count: number;
  month_revenue_cents: number;
  month_payments_count: number;
  verification_queue_count: number;
}

export interface SandboxInvoiceRow {
  id: string;
  invoice_number: string;
  status: string;
  total_cents: number;
  amount_paid_cents: number;
  currency: "THB" | "USD";
  created_at: string;
  customer_name: string;
}
export interface SandboxPaymentRow {
  id: string;
  payment_number: string;
  invoice_id: string;
  invoice_number: string;
  customer_name: string;
  method: "bank_transfer" | "thai_qr" | "promptpay" | "paypal";
  status: string;
  amount_cents: number;
  currency: "THB" | "USD";
  order_id: string | null;
  created_at: string;
}
export interface SandboxSeedResp {
  invoice_id: string;
  invoice_number: string;
  customer_id: string;
  customer_name: string;
  total_cents: number;
  currency: "THB" | "USD";
}
export interface SandboxSimulateResp {
  status: string;
  event_id: string;
  capture_id: string;
  order_id: string;
}

import type {
  Invoice as _Invoice,
  InvoiceItem as _InvoiceItem,
  Payment as _Payment,
  PaymentMethodConfig as _PaymentMethodConfig,
} from "@/lib/payment-types";

export type AdminInvoice = _Invoice;
export type AdminInvoiceFull = _Invoice & { items: _InvoiceItem[]; payments: _Payment[] };
export type AdminPaymentRow = _Payment & { customer_name?: string; invoice_number?: string };
export type AdminPaymentMethodConfig = _PaymentMethodConfig;

export interface AdminCreateInvoiceInput {
  customer_id: string;
  contact_id?: string;
  currency?: "THB" | "USD";
  vat_rate_bp?: number;
  due_date?: string;
  notes?: string;
  items: Array<{
    product_type: "domain" | "hosting" | "sla" | "msp" | "custom";
    product_ref?: string;
    description_en: string;
    description_th?: string;
    quantity: number;
    unit_price_cents: number;
    period_start?: string;
    period_end?: string;
  }>;
}

export interface AdminUpdateInvoiceInput {
  due_date?: string;
  notes?: string;
  items?: AdminCreateInvoiceInput["items"];
}

export interface ModuleAuditEntry {
  actor_email: string | null;
  action: string;
  changes: Record<string, unknown>;
  at: string;
}

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

  // Public showcase + PDPA consent (migration 046). Managed via
  // adminApi.updateCustomerShowcase — do NOT set through updateCustomer.
  show_on_website: boolean;
  website_display_name: string | null;
  website_logo_url: string | null;
  website_industry_label: string | null;
  website_industry_label_th: string | null;
  website_sort_order: number;
  consent_document_url: string | null;
  consent_granted_at: string | null;
  consent_granted_by: string | null;
  consent_expires_at: string | null;
  consent_notes: string | null;
}

// Every field is optional and typed as `T | null` — the backend treats
// "field missing from JSON" as "leave unchanged" and explicit `null` as
// "clear this column". Never pass `undefined` — omit the key instead.
export interface CustomerShowcasePatch {
  show_on_website?: boolean;
  website_display_name?: string | null;
  website_logo_url?: string | null;
  website_industry_label?: string | null;
  website_industry_label_th?: string | null;
  website_sort_order?: number;
  consent_document_url?: string | null;
  consent_granted_at?: string | null;
  consent_granted_by?: string | null;
  consent_expires_at?: string | null;
  consent_notes?: string | null;
}

export interface CustomerShowcaseAuditEntry {
  actor_email?: string | null;
  action: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  at: string;
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

// Services (admin — raw JSONB for both locales)
export interface AdminService {
  id: string;
  slug: string;
  title: { en: string; th?: string };
  short_summary: { en: string; th?: string };
  description: { en: string; th?: string };
  icon: string | null;
  category: "core" | "support" | "opportunistic" | "marketing";
  sort_order: number;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

export interface ServiceWriteInput {
  slug?: string;
  title_en?: string;
  title_th?: string;
  short_summary_en?: string;
  short_summary_th?: string;
  description_en?: string;
  description_th?: string;
  icon?: string | null;
  category?: "core" | "support" | "opportunistic" | "marketing";
  sort_order?: number;
  is_published?: boolean;
}

// Case studies (admin — raw JSONB for both locales)
export interface AdminCaseStudy {
  id: string;
  slug: string;
  client_name: string;
  industry: string;
  location: string | null;
  relationship_years: number | null;
  hero_image_url: string | null;
  summary: { en: string; th?: string };
  challenge: { en: string; th?: string };
  solution: { en: string; th?: string };
  results: { en: string; th?: string };
  quote_text: { en?: string; th?: string };
  quote_author: string | null;
  services_used: string[];
  sort_order: number;
  is_published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CaseStudyWriteInput {
  slug?: string;
  client_name?: string;
  industry?: string;
  location?: string | null;
  relationship_years?: number | null;
  hero_image_url?: string | null;
  summary_en?: string;
  summary_th?: string;
  challenge_en?: string;
  challenge_th?: string;
  solution_en?: string;
  solution_th?: string;
  results_en?: string;
  results_th?: string;
  quote_text_en?: string;
  quote_text_th?: string;
  quote_author?: string | null;
  services_used?: string[];
  sort_order?: number;
  is_published?: boolean;
  published_at?: string | null;
}

// Global app-mode indicator (production / trial / maintenance).
export type AppMode = "production" | "trial" | "maintenance";
export interface AdminAppMode {
  mode: AppMode;
  message_en: string;
  message_th: string;
  updated_at: string;
}

// Home page content — one row per copy block, bilingual value.
export interface AdminHomeContentItem {
  key: string;
  value: { en: string; th?: string };
  updated_at: string;
}

// Static pages (about, privacy, terms, dpa, custom slugs)
export interface AdminPage {
  id: string;
  slug: string;
  title: { en: string; th?: string };
  body_md: { en: string; th?: string };
  seo_title: { en: string; th?: string };
  seo_description: { en: string; th?: string };
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

export interface PageWriteInput {
  slug?: string;
  title_en?: string;
  title_th?: string;
  body_md_en?: string;
  body_md_th?: string;
  seo_title_en?: string;
  seo_title_th?: string;
  seo_description_en?: string;
  seo_description_th?: string;
  is_published?: boolean;
}
