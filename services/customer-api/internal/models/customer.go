package models

import "time"

type Customer struct {
	ID                  string    `json:"id"`
	Slug                string    `json:"slug"`
	Name                string    `json:"name"`
	Industry            *string   `json:"industry,omitempty"`
	PrimaryContactName  *string   `json:"primary_contact_name,omitempty"`
	PrimaryContactEmail *string   `json:"primary_contact_email,omitempty"`
	PrimaryContactPhone *string   `json:"primary_contact_phone,omitempty"`
	AccountManagerID    *string   `json:"account_manager_id,omitempty"`
	AccountManagerName  *string   `json:"account_manager_name,omitempty"`
	AccountManagerEmail *string   `json:"account_manager_email,omitempty"`
	ServicesUsed        []string  `json:"services_used"`
	Notes               *string   `json:"notes,omitempty"`
	IsActive            bool      `json:"is_active"`
	CreatedAt           time.Time `json:"created_at"`
	UpdatedAt           time.Time `json:"updated_at"`

	// Public showcase + PDPA consent (migration 046). Managed through the
	// dedicated PATCH /customers/{id}/showcase endpoint so audit_log gets one
	// atomic row per admin action.
	ShowOnWebsite         bool       `json:"show_on_website"`
	WebsiteDisplayName    *string    `json:"website_display_name,omitempty"`
	WebsiteLogoURL        *string    `json:"website_logo_url,omitempty"`
	WebsiteIndustryLabel  *string    `json:"website_industry_label,omitempty"`
	WebsiteIndustryLabelTH *string   `json:"website_industry_label_th,omitempty"`
	WebsiteSortOrder      int        `json:"website_sort_order"`
	ConsentDocumentURL    *string    `json:"consent_document_url,omitempty"`
	ConsentGrantedAt      *time.Time `json:"consent_granted_at,omitempty"`
	ConsentGrantedBy      *string    `json:"consent_granted_by,omitempty"`
	ConsentExpiresAt      *time.Time `json:"consent_expires_at,omitempty"`
	ConsentNotes          *string    `json:"consent_notes,omitempty"`
}

type Contact struct {
	ID          string     `json:"id"`
	CustomerID  string     `json:"customer_id"`
	Email       string     `json:"email"`
	FullName    string     `json:"full_name"`
	Role        string     `json:"role"`
	LastLoginAt *time.Time `json:"last_login_at,omitempty"`
	DisabledAt  *time.Time `json:"disabled_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`

	// Account lifecycle (migration 071). EmailVerifiedAt is independent of
	// active/disabled — an account can be active while unverified.
	EmailVerifiedAt    *time.Time `json:"email_verified_at,omitempty"`
	MustChangePassword bool       `json:"must_change_password"`
	Phone              *string    `json:"phone,omitempty"`
	JobTitle           *string    `json:"job_title,omitempty"`
	// IsPrimary marks this org as the contact's home org (membership context).
	IsPrimary *bool `json:"is_primary,omitempty"`
}

// OrgMembership is one org a contact belongs to (migration 071). Drives the
// portal org switcher.
type OrgMembership struct {
	CustomerID   string `json:"customer_id"`
	CustomerName string `json:"customer_name"`
	Role         string `json:"role"`
	IsPrimary    bool   `json:"is_primary"`
}

type Ticket struct {
	ID                 string    `json:"id"`
	CustomerID         string    `json:"customer_id"`
	CustomerName       string    `json:"customer_name,omitempty"`
	OpenedByContactID  *string   `json:"opened_by_contact_id,omitempty"`
	OpenedByName       *string   `json:"opened_by_name,omitempty"`
	Subject            string    `json:"subject"`
	Status             string    `json:"status"`
	Priority           string    `json:"priority"`
	AssignedToUserID   *string   `json:"assigned_to_user_id,omitempty"`
	AssignedToName     *string   `json:"assigned_to_name,omitempty"`
	RelatedServiceSlug *string   `json:"related_service_slug,omitempty"`
	Solution           string    `json:"solution"`
	SolutionShared     bool      `json:"solution_shared"`
	BillingStatus      string    `json:"billing_status,omitempty"`
	InvoiceID          *string   `json:"invoice_id,omitempty"`
	LastActivityAt     time.Time `json:"last_activity_at"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
}

// RateCardItem — a managed price-book entry (migration 073).
type RateCardItem struct {
	ID                    string    `json:"id"`
	Code                  *string   `json:"code,omitempty"`
	NameEN                string    `json:"name_en"`
	NameTH                *string   `json:"name_th,omitempty"`
	DescriptionEN         *string   `json:"description_en,omitempty"`
	DescriptionTH         *string   `json:"description_th,omitempty"`
	Unit                  string    `json:"unit"`
	DefaultUnitPriceCents int64     `json:"default_unit_price_cents"`
	Currency              string    `json:"currency"`
	Category              *string   `json:"category,omitempty"`
	IsActive              bool      `json:"is_active"`
	SortOrder             int       `json:"sort_order"`
	CreatedAt             time.Time `json:"created_at"`
	UpdatedAt             time.Time `json:"updated_at"`
}

// TicketLineItem — one priced line attached to a ticket (migration 073).
// Covered lines keep their rate but contribute amount_cents = 0.
type TicketLineItem struct {
	ID             string    `json:"id"`
	TicketID       string    `json:"ticket_id"`
	RateCardItemID *string   `json:"rate_card_item_id,omitempty"`
	DescriptionEN  string    `json:"description_en"`
	DescriptionTH  *string   `json:"description_th,omitempty"`
	Unit           string    `json:"unit"`
	Quantity       int       `json:"quantity"`
	UnitPriceCents int64     `json:"unit_price_cents"`
	Covered        bool      `json:"covered"`
	AmountCents    int64     `json:"amount_cents"`
	Currency       string    `json:"currency"`
	SortOrder      int       `json:"sort_order"`
	CreatedAt      time.Time `json:"created_at"`
}

// TicketBilling — the billing view for one ticket (lines + summary).
type TicketBilling struct {
	TicketID       string           `json:"ticket_id"`
	BillingStatus  string           `json:"billing_status"`
	Currency       string           `json:"currency"`
	Lines          []TicketLineItem `json:"lines"`
	SubtotalCents  int64            `json:"subtotal_cents"` // billable only
	VATRateBP      int              `json:"vat_rate_bp"`
	VATCents       int64            `json:"vat_cents"`
	TotalCents     int64            `json:"total_cents"`
	CoveredByTitle *string          `json:"covered_by_title,omitempty"` // active SLA hint
	InvoiceID      *string          `json:"invoice_id,omitempty"`
	InvoiceNumber  *string          `json:"invoice_number,omitempty"`
	InvoiceStatus  *string          `json:"invoice_status,omitempty"`  // draft|issued|… (portal hides drafts)
	ApprovalID     *string          `json:"approval_id,omitempty"`     // latest quotation approval on the ticket
	ApprovalStatus *string          `json:"approval_status,omitempty"` // gates invoice generation in the admin UI
}

type TicketMessage struct {
	ID              string    `json:"id"`
	TicketID        string    `json:"ticket_id"`
	AuthorUserID    *string   `json:"author_user_id,omitempty"`
	AuthorContactID *string   `json:"author_contact_id,omitempty"`
	AuthorName      string    `json:"author_name"`
	AuthorKind      string    `json:"author_kind"` // "staff" | "customer"
	Body            string    `json:"body"`
	Internal        bool      `json:"internal"`
	CreatedAt       time.Time `json:"created_at"`
}

type Domain struct {
	ID              string     `json:"id"`
	CustomerID      string     `json:"customer_id"`
	Domain          string     `json:"domain"`
	Registrar       string     `json:"registrar"`
	ExpiresAt       *time.Time `json:"expires_at,omitempty"`
	PrivacyEnabled  bool       `json:"privacy_enabled"`
	AutoRenew       bool       `json:"auto_renew"`
	Notes           *string    `json:"notes,omitempty"`
	LastDNSChangeAt *time.Time `json:"last_dns_change_at,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

// DomainOrder mirrors the reseller-api shape but only the fields portal
// users care about. Customers see orders they own; staff see the full
// admin view via reseller-api.
type DomainOrder struct {
	ID              string    `json:"id"`
	SLD             string    `json:"sld"`
	TLD             string    `json:"tld"`
	FQDN            string    `json:"fqdn"`
	Registry        string    `json:"registry"`
	Years           int       `json:"years"`
	PrivacyEnabled  bool      `json:"privacy_enabled"`
	Status          string    `json:"status"`
	RegistryOrderID *string   `json:"registry_order_id,omitempty"`
	Notes           *string   `json:"notes,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type SLAContract struct {
	ID              string    `json:"id"`
	CustomerID      string    `json:"customer_id"`
	ServiceSlug     string    `json:"service_slug"`
	Title           string    `json:"title"`
	StartsOn        string    `json:"starts_on"`
	EndsOn          string    `json:"ends_on"`
	TargetUptimePct float64   `json:"target_uptime_pct"`
	Status          string    `json:"status"`
	Notes           *string   `json:"notes,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}
