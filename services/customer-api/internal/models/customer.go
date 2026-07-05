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
	LastActivityAt     time.Time `json:"last_activity_at"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
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
