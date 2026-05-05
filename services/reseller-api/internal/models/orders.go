package models

import "time"

// Classification mirrors domain_availability_cache.classification.
type Classification string

const (
	ClassAvailable  Classification = "available"
	ClassRegistered Classification = "registered"
	ClassReserved   Classification = "reserved"
	ClassPremium    Classification = "premium"
	ClassManual     Classification = "manual"
	ClassUnknown    Classification = "unknown"
)

type AvailabilityResult struct {
	FQDN           string         `json:"fqdn"`
	TLD            string         `json:"tld"`
	Available      bool           `json:"available"`
	Classification Classification `json:"classification"`
	Source         string         `json:"source"` // resellerclub | thnic_stub | mock
	Cached         bool           `json:"cached"`
	CheckedAt      time.Time      `json:"checked_at"`
}

type DomainOrder struct {
	ID                string    `json:"id"`
	SLD               string    `json:"sld"`
	TLD               string    `json:"tld"`
	FQDN              string    `json:"fqdn"`
	Registry          string    `json:"registry"`
	CustomerID        *string   `json:"customer_id,omitempty"`
	LeadID            *string   `json:"lead_id,omitempty"`
	RequestedByUserID *string   `json:"requested_by_user_id,omitempty"`
	ContactName       *string   `json:"contact_name,omitempty"`
	ContactEmail      *string   `json:"contact_email,omitempty"`
	ContactPhone      *string   `json:"contact_phone,omitempty"`
	ContactCompany    *string   `json:"contact_company,omitempty"`
	Years             int       `json:"years"`
	PrivacyEnabled    bool      `json:"privacy_enabled"`
	Status            string    `json:"status"`
	RegistryOrderID   *string   `json:"registry_order_id,omitempty"`
	Notes             *string   `json:"notes,omitempty"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}
