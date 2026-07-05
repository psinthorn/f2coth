package models

import (
	"encoding/json"
	"time"
)

type Invoice struct {
	ID              string          `json:"id"`
	InvoiceNumber   string          `json:"invoice_number"`
	CustomerID      string          `json:"customer_id"`
	ContactID       *string         `json:"contact_id,omitempty"`
	Status          string          `json:"status"`
	DocType         string          `json:"doc_type"`
	Currency        string          `json:"currency"`
	SubtotalCents   int64           `json:"subtotal_cents"`
	VATRateBP       int             `json:"vat_rate_bp"`
	VATCents        int64           `json:"vat_cents"`
	TotalCents      int64           `json:"total_cents"`
	AmountPaidCents int64           `json:"amount_paid_cents"`
	IssueDate       *time.Time      `json:"issue_date,omitempty"`
	DueDate         *time.Time      `json:"due_date,omitempty"`
	PaidAt          *time.Time      `json:"paid_at,omitempty"`
	VoidedAt        *time.Time      `json:"voided_at,omitempty"`
	VoidReason      *string         `json:"void_reason,omitempty"`
	Notes           *string         `json:"notes,omitempty"`
	Metadata        json.RawMessage `json:"metadata,omitempty"`
	BillingSnapshot json.RawMessage `json:"billing_snapshot,omitempty"`
	CreatedAt       time.Time       `json:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at"`
	Items           []InvoiceItem   `json:"items,omitempty"`
	Payments        []Payment       `json:"payments,omitempty"`
	CustomerName    string          `json:"customer_name,omitempty"`
}

type InvoiceItem struct {
	ID             string  `json:"id"`
	InvoiceID      string  `json:"invoice_id"`
	ProductType    string  `json:"product_type"`
	ProductRef     *string `json:"product_ref,omitempty"`
	DescriptionEN  string  `json:"description_en"`
	DescriptionTH  *string `json:"description_th,omitempty"`
	Quantity       int     `json:"quantity"`
	UnitPriceCents int64   `json:"unit_price_cents"`
	TotalCents     int64   `json:"total_cents"`
	PeriodStart    *string `json:"period_start,omitempty"`
	PeriodEnd      *string `json:"period_end,omitempty"`
	SortOrder      int     `json:"sort_order"`
}

type Payment struct {
	ID                string          `json:"id"`
	PaymentNumber     string          `json:"payment_number"`
	InvoiceID         string          `json:"invoice_id"`
	CustomerID        string          `json:"customer_id"`
	Method            string          `json:"method"`
	Status            string          `json:"status"`
	AmountCents       int64           `json:"amount_cents"`
	Currency          string          `json:"currency"`
	Provider          *string         `json:"provider,omitempty"`
	ProviderOrderID   *string         `json:"provider_order_id,omitempty"`
	ProviderCaptureID *string         `json:"provider_capture_id,omitempty"`
	SlipURL           *string         `json:"slip_url,omitempty"`
	SlipUploadedAt    *time.Time      `json:"slip_uploaded_at,omitempty"`
	BankRef           *string         `json:"bank_ref,omitempty"`
	TransferredAt     *time.Time      `json:"transferred_at,omitempty"`
	VerifiedAt        *time.Time      `json:"verified_at,omitempty"`
	RejectedReason    *string         `json:"rejected_reason,omitempty"`
	PaidAt            *time.Time      `json:"paid_at,omitempty"`
	ExpiresAt         *time.Time      `json:"expires_at,omitempty"`
	FailureReason     *string         `json:"failure_reason,omitempty"`
	Metadata          json.RawMessage `json:"metadata,omitempty"`
	CreatedAt         time.Time       `json:"created_at"`
	UpdatedAt         time.Time       `json:"updated_at"`
}

type PaymentMethodConfig struct {
	Method         string          `json:"method"`
	Enabled        bool            `json:"enabled"`
	Mode           string          `json:"mode"`
	DisplayNameEN  string          `json:"display_name_en"`
	DisplayNameTH  string          `json:"display_name_th"`
	InstructionsEN *string         `json:"instructions_en,omitempty"`
	InstructionsTH *string         `json:"instructions_th,omitempty"`
	Config         json.RawMessage `json:"config"`
	SortOrder      int             `json:"sort_order"`
	UpdatedAt      time.Time       `json:"updated_at"`
}
