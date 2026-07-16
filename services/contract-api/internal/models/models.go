package models

import (
	"encoding/json"
	"time"
)

// Party is the customer/legal entity on a contract (contract_parties). It may
// optionally link to a portal customer via CustomerID.
type Party struct {
	ID            string    `json:"id"`
	CustomerID    *string   `json:"customer_id,omitempty"`
	LegalNameEN   string    `json:"legal_name_en"`
	LegalNameTH   string    `json:"legal_name_th"`
	BrandName     *string   `json:"brand_name,omitempty"`
	TaxID         *string   `json:"tax_id,omitempty"`
	Address       *string   `json:"address,omitempty"`
	NoticeEmail   *string   `json:"notice_email,omitempty"`
	ContactPerson *string   `json:"contact_person,omitempty"`
	Phone         *string   `json:"phone,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// Template is a document type (contract_templates). Code maps to a docgen
// builder; MergeSchema drives the admin wizard form.
type Template struct {
	ID          string          `json:"id"`
	Code        string          `json:"code"`
	Name        string          `json:"name"`
	Version     string          `json:"version"`
	DocPrefix   string          `json:"doc_prefix"`
	MergeSchema json.RawMessage `json:"merge_schema"`
	IsActive    bool            `json:"is_active"`
	CreatedAt   time.Time       `json:"created_at"`
	UpdatedAt   time.Time       `json:"updated_at"`
}

// Contract is a single agreement instance (contracts). MergeData is the
// snapshot of filled merge fields.
type Contract struct {
	ID            string          `json:"id"`
	DocNo         string          `json:"doc_no"`
	TemplateID    string          `json:"template_id"`
	TemplateCode  string          `json:"template_code,omitempty"`
	TemplateName  string          `json:"template_name,omitempty"`
	PartyID       string          `json:"party_id"`
	PartyName     string          `json:"party_name,omitempty"`
	ProjectID     *string         `json:"project_id,omitempty"`
	MergeData     json.RawMessage `json:"merge_data"`
	Status        string          `json:"status"`
	EffectiveDate *string         `json:"effective_date,omitempty"`
	EndDate       *string         `json:"end_date,omitempty"`
	FeeTotal      *float64        `json:"fee_total,omitempty"`
	CreatedBy     *string         `json:"created_by,omitempty"`
	CreatedAt     time.Time       `json:"created_at"`
	UpdatedAt     time.Time       `json:"updated_at"`

	// Populated on the detail view.
	Party  *Party        `json:"party,omitempty"`
	Files  []File        `json:"files,omitempty"`
	Events []StatusEvent `json:"events,omitempty"`
}

// File is metadata for an artifact stored on the volume (contract_files).
type File struct {
	ID          string    `json:"id"`
	ContractID  string    `json:"contract_id"`
	Kind        string    `json:"kind"`
	Filename    string    `json:"filename"`
	StoragePath string    `json:"-"` // internal; never serialised to clients
	MimeType    string    `json:"mime_type"`
	SizeBytes   int64     `json:"size_bytes"`
	SHA256      *string   `json:"sha256,omitempty"`
	UploadedBy  *string   `json:"uploaded_by,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

// StatusEvent is one entry in a contract's status timeline
// (contract_status_events).
type StatusEvent struct {
	ID         string    `json:"id"`
	ContractID string    `json:"contract_id"`
	FromStatus *string   `json:"from_status,omitempty"`
	ToStatus   string    `json:"to_status"`
	Note       *string   `json:"note,omitempty"`
	ChangedBy  *string   `json:"changed_by,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
}
