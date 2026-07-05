// Shared types + small helpers for the payment system. Used by both the
// customer portal and the admin console. Money is always stored as int64
// minor units (satang for THB, cents for USD) on the wire — never as a
// float. Helpers here are the single place we format/parse those.

export type PaymentMethod =
  | "bank_transfer"
  | "thai_qr"
  | "promptpay"
  | "paypal";

export type InvoiceStatus =
  | "draft"
  | "issued"
  | "partially_paid"
  | "paid"
  | "void"
  | "refunded"
  | "overdue";

export type PaymentStatus =
  | "pending"
  | "awaiting_verification"
  | "completed"
  | "failed"
  | "expired"
  | "refunded";

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  product_type: "domain" | "hosting" | "sla" | "msp" | "custom";
  product_ref: string | null;
  description_en: string;
  description_th: string | null;
  quantity: number;
  unit_price_cents: number;
  total_cents: number;
  period_start: string | null;
  period_end: string | null;
  sort_order: number;
}

export interface Payment {
  id: string;
  payment_number: string;
  invoice_id: string;
  customer_id: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount_cents: number;
  currency: "THB" | "USD";
  provider: string | null;
  provider_order_id: string | null;
  provider_capture_id: string | null;
  slip_url: string | null;
  slip_uploaded_at: string | null;
  bank_ref: string | null;
  transferred_at: string | null;
  verified_at: string | null;
  rejected_reason: string | null;
  paid_at: string | null;
  expires_at: string | null;
  failure_reason: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  customer_id: string;
  contact_id: string | null;
  status: InvoiceStatus;
  doc_type: "quotation" | "invoice" | "tax_invoice" | "receipt";
  billing_snapshot?: Record<string, unknown>;
  currency: "THB" | "USD";
  subtotal_cents: number;
  vat_rate_bp: number;
  vat_cents: number;
  total_cents: number;
  amount_paid_cents: number;
  issue_date: string | null;
  due_date: string | null;
  paid_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  notes: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  items?: InvoiceItem[];
  payments?: Payment[];
  customer_name?: string;
}

export interface PaymentMethodConfig {
  method: PaymentMethod;
  enabled: boolean;
  mode: "sandbox" | "production";
  display_name_en: string;
  display_name_th: string;
  instructions_en: string | null;
  instructions_th: string | null;
  config: Record<string, unknown>;
  sort_order: number;
  updated_at: string;
}

export interface InitPaymentResp {
  payment_id: string;
  method: PaymentMethod;
  status: PaymentStatus;
  approval_url?: string;
  method_config?: Record<string, unknown>;
}

// ---------- formatting ----------

export function formatMoney(cents: number, currency: "THB" | "USD" = "THB"): string {
  const amount = cents / 100;
  if (currency === "USD") {
    return `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `฿${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function invoiceStatusTone(s: InvoiceStatus): string {
  switch (s) {
    case "paid":
      return "bg-emerald-50 text-emerald-800";
    case "partially_paid":
      return "bg-blue-50 text-blue-800";
    case "issued":
      return "bg-amber-50 text-amber-800";
    case "overdue":
      return "bg-red-50 text-red-800";
    case "void":
    case "refunded":
      return "bg-navy-100 text-navy-700";
    default:
      return "bg-navy-50 text-navy-700";
  }
}

export function paymentStatusTone(s: PaymentStatus): string {
  switch (s) {
    case "completed":
      return "bg-emerald-50 text-emerald-800";
    case "awaiting_verification":
      return "bg-amber-50 text-amber-800";
    case "pending":
      return "bg-blue-50 text-blue-800";
    case "failed":
    case "expired":
      return "bg-red-50 text-red-800";
    case "refunded":
      return "bg-navy-100 text-navy-700";
    default:
      return "bg-navy-50 text-navy-700";
  }
}
