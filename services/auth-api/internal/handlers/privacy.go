package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/mail"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/f2cothai/f2-website/services/auth-api/internal/config"
	authmw "github.com/f2cothai/f2-website/services/auth-api/internal/middleware"
)

var privacyUUIDRE = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

// PrivacyHandler handles PDPA Data Subject Request (DSR) endpoints.
//   Public:  POST /api/privacy/dsr           — any visitor submits a request
//   Admin:   GET  /api/privacy/dsr            — list all DSRs (admin only)
//   Admin:   GET  /api/privacy/dsr/{id}       — get single DSR
//   Admin:   PATCH /api/privacy/dsr/{id}      — update status / assign / respond

type PrivacyHandler struct {
	DB  *pgxpool.Pool
	Cfg config.Config
}

type dsrSubmitReq struct {
	RequesterEmail string `json:"requester_email"`
	RequesterName  string `json:"requester_name"`
	RequestType    string `json:"request_type"`
	Description    string `json:"description"`
	Locale         string `json:"locale"`
}

type dsrUpdateReq struct {
	Status        string `json:"status"`
	AssignedTo    string `json:"assigned_to"`
	ResponseNotes string `json:"response_notes"`
}

type dsrRow struct {
	ID             string     `json:"id"`
	RequesterEmail string     `json:"requester_email"`
	RequesterName  string     `json:"requester_name"`
	RequestType    string     `json:"request_type"`
	Description    string     `json:"description"`
	Locale         string     `json:"locale"`
	Status         string     `json:"status"`
	AssignedTo     *string    `json:"assigned_to,omitempty"`
	DueDate        time.Time  `json:"due_date"`
	ResponseNotes  *string    `json:"response_notes,omitempty"`
	FulfilledAt    *time.Time `json:"fulfilled_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
}

var validRequestTypes = map[string]bool{
	"access": true, "rectification": true, "erasure": true,
	"portability": true, "objection": true, "restrict": true,
}

var validDSRStatuses = map[string]bool{
	"pending": true, "in_progress": true, "completed": true,
	"rejected": true, "withdrawn": true,
}

// SubmitDSR — public endpoint. Any visitor can submit a data subject request.
// POST /api/privacy/dsr
func (h *PrivacyHandler) SubmitDSR(w http.ResponseWriter, r *http.Request) {
	var req dsrSubmitReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	req.RequesterEmail = strings.TrimSpace(strings.ToLower(req.RequesterEmail))
	req.RequesterName = strings.TrimSpace(req.RequesterName)
	if req.RequesterEmail == "" || req.RequesterName == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "requester_email and requester_name required"})
		return
	}
	if _, err := mail.ParseAddress(req.RequesterEmail); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid requester_email"})
		return
	}
	if !validRequestTypes[req.RequestType] {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request_type"})
		return
	}
	if req.Locale != "en" && req.Locale != "th" {
		req.Locale = "en"
	}

	var id string
	var dueDate time.Time
	err := h.DB.QueryRow(r.Context(), `
		INSERT INTO data_subject_requests
			(requester_email, requester_name, request_type, description, locale)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, due_date`,
		req.RequesterEmail, req.RequesterName, req.RequestType,
		req.Description, req.Locale,
	).Scan(&id, &dueDate)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create request"})
		return
	}

	// TODO: enqueue dsr_received_requester + dsr_received_staff notification jobs
	// (hand off to notification-api — same pattern as lead-api)

	go h.dispatchDSRNotifications(id, req, dueDate)

	writeJSON(w, http.StatusCreated, map[string]string{
		"id":      id,
		"message": "Your request has been received. We will respond within 30 days.",
	})
}

// ListDSRs — admin only.
// GET /api/privacy/dsr?status=pending
func (h *PrivacyHandler) ListDSRs(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	var rows []dsrRow

	query := `
		SELECT id, requester_email, requester_name, request_type, description,
		       locale, status, assigned_to::text, due_date, response_notes, fulfilled_at, created_at
		FROM data_subject_requests`
	args := []any{}
	if status != "" && validDSRStatuses[status] {
		query += " WHERE status = $1"
		args = append(args, status)
	}
	query += " ORDER BY due_date ASC, created_at ASC"

	pgRows, err := h.DB.Query(r.Context(), query, args...)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "query failed"})
		return
	}
	defer pgRows.Close()
	for pgRows.Next() {
		var row dsrRow
		if err := pgRows.Scan(
			&row.ID, &row.RequesterEmail, &row.RequesterName, &row.RequestType,
			&row.Description, &row.Locale, &row.Status, &row.AssignedTo,
			&row.DueDate, &row.ResponseNotes, &row.FulfilledAt, &row.CreatedAt,
		); err != nil {
			continue
		}
		rows = append(rows, row)
	}
	if rows == nil {
		rows = []dsrRow{}
	}
	writeJSON(w, http.StatusOK, rows)
}

// GetDSR — admin only.
// GET /api/privacy/dsr/{id}
func (h *PrivacyHandler) GetDSR(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var row dsrRow
	err := h.DB.QueryRow(r.Context(), `
		SELECT id, requester_email, requester_name, request_type, description,
		       locale, status, assigned_to::text, due_date, response_notes, fulfilled_at, created_at
		FROM data_subject_requests WHERE id = $1`, id,
	).Scan(
		&row.ID, &row.RequesterEmail, &row.RequesterName, &row.RequestType,
		&row.Description, &row.Locale, &row.Status, &row.AssignedTo,
		&row.DueDate, &row.ResponseNotes, &row.FulfilledAt, &row.CreatedAt,
	)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	writeJSON(w, http.StatusOK, row)
}

// UpdateDSR — admin only. Updates status, assignment, response notes.
// PATCH /api/privacy/dsr/{id}
func (h *PrivacyHandler) UpdateDSR(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req dsrUpdateReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8*1024)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if req.Status != "" && !validDSRStatuses[req.Status] {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid status"})
		return
	}

	// Set fulfilled_at when transitioning to completed.
	var fulfilledAt *time.Time
	if req.Status == "completed" {
		now := time.Now().UTC()
		fulfilledAt = &now
	}

	// Only set assigned_to if a valid UUID string was provided.
	var assignedTo *string
	if req.AssignedTo != "" {
		if !privacyUUIDRE.MatchString(req.AssignedTo) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "assigned_to must be a UUID"})
			return
		}
		assignedTo = &req.AssignedTo
	}

	_, err := h.DB.Exec(r.Context(), `
		UPDATE data_subject_requests SET
			status         = COALESCE(NULLIF($2,''), status),
			assigned_to    = COALESCE($3::uuid, assigned_to),
			response_notes = COALESCE(NULLIF($4,''), response_notes),
			fulfilled_at   = COALESCE($5, fulfilled_at)
		WHERE id = $1`,
		id, req.Status, assignedTo, req.ResponseNotes, fulfilledAt,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "update failed"})
		return
	}

	h.GetDSR(w, r)
}

// RequireAdminMiddleware returns the admin-only middleware chain for privacy routes.
// Reuses authmw.RequireJWT + authmw.RequireRole — no new middleware written.
func (h *PrivacyHandler) RequireAdmin(next http.Handler) http.Handler {
	return authmw.RequireJWT(h.Cfg.JWTSecret)(authmw.RequireRole("admin")(next))
}

// dispatchDSRNotifications fires two emails: one to the requester (ACK in their locale)
// and one to the F2 privacy team (always EN). Best-effort — never blocks the HTTP response.
func (h *PrivacyHandler) dispatchDSRNotifications(dsrID string, req dsrSubmitReq, dueDate time.Time) {
	type notifyReq struct {
		Channel      string         `json:"channel"`
		Template     string         `json:"template"`
		ToAddress    string         `json:"to_address"`
		Payload      map[string]any `json:"payload"`
		RelatedDSRID string         `json:"related_dsr_id,omitempty"`
		Locale       string         `json:"locale"`
	}

	adminURL := h.Cfg.SiteURL + "/admin/dsr/" + dsrID

	payload := map[string]any{
		"name":         req.RequesterName,
		"email":        req.RequesterEmail,
		"request_type": req.RequestType,
		"id":           dsrID,
		"due_date":     dueDate.Format("2006-01-02"),
		"admin_url":    adminURL,
	}

	send := func(nr notifyReq) {
		body, _ := json.Marshal(nr)
		client := &http.Client{Timeout: 5 * time.Second}
		_, _ = client.Post(
			h.Cfg.NotificationAPIURL+"/api/notifications",
			"application/json",
			bytes.NewReader(body),
		)
	}

	// Requester acknowledgement in their browsing locale.
	send(notifyReq{
		Channel: "email", Template: "dsr_received_requester",
		ToAddress: req.RequesterEmail, Payload: payload,
		RelatedDSRID: dsrID, Locale: req.Locale,
	})
	// Privacy team alert — always EN (internal operational tool).
	send(notifyReq{
		Channel: "email", Template: "dsr_received_staff",
		ToAddress: h.Cfg.PrivacyNotifyTo, Payload: payload,
		RelatedDSRID: dsrID, Locale: "en",
	})
}
