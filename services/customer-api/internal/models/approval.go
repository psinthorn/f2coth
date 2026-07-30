package models

import "time"

// Approval is a reusable customer sign-off request (migration 075). Soft-
// polymorphic over (SubjectType, SubjectID); v1 subject is 'ticket'. Money is
// a frozen snapshot taken at send time (satang; VAT in basis points).
type Approval struct {
	ID                 string         `json:"id"`
	SubjectType        string         `json:"subject_type"`
	SubjectID          string         `json:"subject_id"`
	CustomerID         string         `json:"customer_id"`
	CustomerName       string         `json:"customer_name,omitempty"`
	Kind               string         `json:"kind"`   // quotation | resolution | general
	Status             string         `json:"status"` // draft|sent|approved|declined|cancelled|expired
	Title              string         `json:"title"`
	BodyMD             string         `json:"body_md"`
	Currency           *string        `json:"currency,omitempty"`
	SubtotalCents      int64          `json:"subtotal_cents"`
	VATRateBP          int            `json:"vat_rate_bp"`
	VATCents           int64          `json:"vat_cents"`
	TotalCents         int64          `json:"total_cents"`
	RequestedByUserID  *string        `json:"requested_by_user_id,omitempty"`
	DecidedByContactID *string        `json:"decided_by_contact_id,omitempty"`
	DecidedByName      *string        `json:"decided_by_name,omitempty"`
	DecidedVia         *string        `json:"decided_via,omitempty"`
	DecidedAt          *time.Time     `json:"decided_at,omitempty"`
	DeclineReason      *string        `json:"decline_reason,omitempty"`
	SentAt             *time.Time     `json:"sent_at,omitempty"`
	ExpiresAt          *time.Time     `json:"expires_at,omitempty"`
	CreatedAt          time.Time      `json:"created_at"`
	UpdatedAt          time.Time      `json:"updated_at"`
	Items              []ApprovalItem `json:"items,omitempty"`
}

// ApprovalItem is one line in the bundle the customer approves as a whole.
type ApprovalItem struct {
	ID             string    `json:"id"`
	ApprovalID     string    `json:"approval_id"`
	ItemType       string    `json:"item_type"` // line | issue | text
	RefType        *string   `json:"ref_type,omitempty"`
	RefID          *string   `json:"ref_id,omitempty"`
	Label          string    `json:"label"`
	DetailMD       string    `json:"detail_md"`
	Quantity       *int      `json:"quantity,omitempty"`
	Unit           *string   `json:"unit,omitempty"`
	UnitPriceCents *int64    `json:"unit_price_cents,omitempty"`
	AmountCents    int64     `json:"amount_cents"`
	SortOrder      int       `json:"sort_order"`
	CreatedAt      time.Time `json:"created_at"`
}
