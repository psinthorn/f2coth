// Package iacc is a stub for the planned integration with the iACC
// accounting system (psinthorn/iacc-php-mvc, prod at iacc.f2.co.th).
//
// iACC already exposes a REST API (api.php/*) with API-key auth, rate
// limiting, idempotency keys, and webhooks. The plan is:
//
//	monthly close
//	  → GET  /api/checklists/projects/{id}/report?range=monthly
//	  → POST invoice draft to iACC via API key + idempotency key
//	  → store returned invoice ID against the project for reconciliation
//
// Nothing here calls out yet. When we wire it up, we'll only need to
// implement Client with a real HTTP round-tripper — the interface and
// data shapes below shouldn't need to change.
package iacc

import "context"

// Client is the surface every consumer inside checklist-api should depend
// on so the real implementation stays a swap-in.
type Client interface {
	// CreateInvoiceDraft posts a draft invoice for the given iACC company
	// (Project.IACCCompanyID). Idempotent by IdempotencyKey. Returns the
	// iACC invoice ID on success.
	CreateInvoiceDraft(ctx context.Context, req InvoiceDraft) (string, error)
}

// InvoiceDraft matches iACC's expected POST body (subset — extend as we
// build out the mapping).
type InvoiceDraft struct {
	CompanyID      string        `json:"company_id"`
	IdempotencyKey string        `json:"idempotency_key"`
	IssueDate      string        `json:"issue_date"` // YYYY-MM-DD
	DueDate        string        `json:"due_date"`   // YYYY-MM-DD
	CurrencyCode   string        `json:"currency"`
	Lines          []InvoiceLine `json:"lines"`
	Notes          string        `json:"notes"`
}

type InvoiceLine struct {
	Description string  `json:"description"`
	Quantity    float64 `json:"quantity"`
	UnitPrice   float64 `json:"unit_price"`
}

// Stub is a no-op implementation used until we wire the real HTTP client.
// It intentionally returns a clear error so calls fail loudly rather than
// silently succeed in dev.
type Stub struct{}

func (Stub) CreateInvoiceDraft(_ context.Context, _ InvoiceDraft) (string, error) {
	return "", ErrNotConfigured
}

// ErrNotConfigured signals the stub is active — replace with the real
// Client (config + HTTP round-tripper) to enable posting to iACC.
var ErrNotConfigured = stubError("iacc client not configured")

type stubError string

func (e stubError) Error() string { return string(e) }
