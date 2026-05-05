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
	ID                  string    `json:"id"`
	CustomerID          string    `json:"customer_id"`
	CustomerName        string    `json:"customer_name,omitempty"`
	OpenedByContactID   *string   `json:"opened_by_contact_id,omitempty"`
	OpenedByName        *string   `json:"opened_by_name,omitempty"`
	Subject             string    `json:"subject"`
	Status              string    `json:"status"`
	Priority            string    `json:"priority"`
	AssignedToUserID    *string   `json:"assigned_to_user_id,omitempty"`
	AssignedToName      *string   `json:"assigned_to_name,omitempty"`
	RelatedServiceSlug  *string   `json:"related_service_slug,omitempty"`
	LastActivityAt      time.Time `json:"last_activity_at"`
	CreatedAt           time.Time `json:"created_at"`
	UpdatedAt           time.Time `json:"updated_at"`
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
