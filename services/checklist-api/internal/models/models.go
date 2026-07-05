package models

import "time"

type Template struct {
	ID        string    `json:"id"`
	Code      string    `json:"code"`
	NameEN    string    `json:"name_en"`
	NameTH    string    `json:"name_th"`
	Icon      *string   `json:"icon,omitempty"`
	SortOrder int       `json:"sort_order"`
	IsActive  bool      `json:"is_active"`
	ItemCount int       `json:"item_count"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type TemplateItem struct {
	ID         string    `json:"id"`
	TemplateID string    `json:"template_id"`
	TextEN     string    `json:"text_en"`
	TextTH     string    `json:"text_th"`
	SortOrder  int       `json:"sort_order"`
	Required   bool      `json:"required"`
	CreatedAt  time.Time `json:"created_at"`
}

type Project struct {
	ID                string     `json:"id"`
	ClientName        string     `json:"client_name"`
	Name              string     `json:"name"`
	Status            string     `json:"status"`
	StartDate         *time.Time `json:"start_date,omitempty"`
	EndDate           *time.Time `json:"end_date,omitempty"`
	IACCCompanyID     *string    `json:"iacc_company_id,omitempty"`
	CustomerID        *string    `json:"customer_id,omitempty"`
	CustomerName      *string    `json:"customer_name,omitempty"` // joined from customers.name when linked
	VisibleToCustomer bool       `json:"visible_to_customer"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
	// Populated by list/get endpoints for progress display in the UI:
	DoneCount  int `json:"done_count,omitempty"`
	TotalCount int `json:"total_count,omitempty"`
	FailCount  int `json:"fail_count,omitempty"`
}

type ProjectModule struct {
	ID         string        `json:"id"`
	ProjectID  string        `json:"project_id"`
	TemplateID string        `json:"template_id"`
	Code       string        `json:"code"`
	NameEN     string        `json:"name_en"`
	NameTH     string        `json:"name_th"`
	Icon       *string       `json:"icon,omitempty"`
	Position   int           `json:"position"`
	AddedBy    *string       `json:"added_by,omitempty"`
	AddedAt    time.Time     `json:"added_at"`
	Items      []ProjectItem `json:"items"`
}

type ProjectItem struct {
	ID              string     `json:"id"`
	ProjectModuleID string     `json:"project_module_id"`
	TextEN          string     `json:"text_en"`
	TextTH          string     `json:"text_th"`
	SortOrder       int        `json:"sort_order"`
	Required        bool       `json:"required"`
	Status          string     `json:"status"`
	Note            *string    `json:"note,omitempty"`
	PhotoURL        *string    `json:"photo_url,omitempty"`
	CheckedBy       *string    `json:"checked_by,omitempty"`
	CheckedAt       *time.Time `json:"checked_at,omitempty"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

type VisitLog struct {
	ID         string     `json:"id"`
	ProjectID  string     `json:"project_id"`
	VisitDate  time.Time  `json:"visit_date"`
	Summary    string     `json:"summary"`
	Billable   bool       `json:"billable"`
	Amount     *float64   `json:"amount,omitempty"`
	CreatedBy  *string    `json:"created_by,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
}

// ProgressPerModule is what /projects/{id}/progress returns per attached module.
type ProgressPerModule struct {
	ProjectModuleID string `json:"project_module_id"`
	TemplateCode    string `json:"code"`
	NameEN          string `json:"name_en"`
	NameTH          string `json:"name_th"`
	Total           int    `json:"total"`
	Done            int    `json:"done"`
	Fail            int    `json:"fail"`
	NA              int    `json:"na"`
	Pending         int    `json:"pending"`
}

// Report is the shape returned by /projects/{id}/report.
type Report struct {
	ProjectID  string             `json:"project_id"`
	Range      string             `json:"range"`
	FromDate   time.Time          `json:"from_date"`
	ToDate     time.Time          `json:"to_date"`
	Items      []ReportItemChange `json:"items"`
	Visits     []VisitLog         `json:"visits"`
	Totals     ProgressTotals     `json:"totals"`
}

type ProgressTotals struct {
	Total   int `json:"total"`
	Done    int `json:"done"`
	Pass    int `json:"pass"`
	Fail    int `json:"fail"`
	NA      int `json:"na"`
	Pending int `json:"pending"`
}

type ReportItemChange struct {
	ItemID    string    `json:"item_id"`
	ModuleID  string    `json:"module_id"`
	Code      string    `json:"code"`
	TextEN    string    `json:"text_en"`
	TextTH    string    `json:"text_th"`
	Status    string    `json:"status"`
	Note      *string   `json:"note,omitempty"`
	PhotoURL  *string   `json:"photo_url,omitempty"`
	CheckedAt time.Time `json:"checked_at"`
}
