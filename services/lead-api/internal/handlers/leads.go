package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/f2cothai/f2-website/services/lead-api/internal/config"
	authmw "github.com/f2cothai/f2-website/services/lead-api/internal/middleware"
	"github.com/f2cothai/f2-website/services/lead-api/internal/models"
)

type LeadHandler struct {
	DB  *pgxpool.Pool
	Cfg config.Config
}

type leadCreateReq struct {
	FullName     string   `json:"full_name"`
	Email        string   `json:"email"`
	Phone        string   `json:"phone"`
	Company      string   `json:"company"`
	PropertyName string   `json:"property_name"`
	PropertyType string   `json:"property_type"`
	Interest     []string `json:"interest"`
	Message      string   `json:"message"`
	Source       string   `json:"source"`
	UTMSource    string   `json:"utm_source"`
	UTMMedium    string   `json:"utm_medium"`
	UTMCampaign  string   `json:"utm_campaign"`
	Locale       string   `json:"locale"`  // visitor's browsing locale
	HoneyPot     string   `json:"website"` // bots fill hidden fields named "website"
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func (h *LeadHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req leadCreateReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}

	// Honeypot — silently accept-and-drop bot submissions.
	if strings.TrimSpace(req.HoneyPot) != "" {
		writeJSON(w, http.StatusAccepted, map[string]any{"ok": true})
		return
	}

	req.FullName = strings.TrimSpace(req.FullName)
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.Message = strings.TrimSpace(req.Message)
	if req.FullName == "" || req.Email == "" || req.Message == "" {
		writeErr(w, http.StatusBadRequest, "full_name, email, message are required")
		return
	}
	if _, err := mail.ParseAddress(req.Email); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid email")
		return
	}
	if len(req.Message) > 5000 {
		writeErr(w, http.StatusBadRequest, "message too long")
		return
	}
	if req.Source == "" {
		req.Source = "contact_form"
	}
	if req.Interest == nil {
		req.Interest = []string{}
	}

	var lead models.Lead
	err := h.DB.QueryRow(r.Context(), `
        INSERT INTO leads (
            full_name, email, phone, company, property_name, property_type,
            interest, message, source, ip_address, user_agent,
            utm_source, utm_medium, utm_campaign
        ) VALUES (
            $1,$2,NULLIF($3,''),NULLIF($4,''),NULLIF($5,''),NULLIF($6,''),
            $7,$8,$9,NULLIF($10,'')::inet,$11,
            NULLIF($12,''),NULLIF($13,''),NULLIF($14,'')
        )
        RETURNING id, full_name, email, phone, company, property_name, property_type,
                  interest, message, source, status, utm_source, utm_medium, utm_campaign,
                  created_at, updated_at
    `,
		req.FullName, req.Email, req.Phone, req.Company, req.PropertyName, req.PropertyType,
		req.Interest, req.Message, req.Source, r.RemoteAddr, r.UserAgent(),
		req.UTMSource, req.UTMMedium, req.UTMCampaign,
	).Scan(&lead.ID, &lead.FullName, &lead.Email, &lead.Phone, &lead.Company,
		&lead.PropertyName, &lead.PropertyType, &lead.Interest, &lead.Message,
		&lead.Source, &lead.Status, &lead.UTMSource, &lead.UTMMedium, &lead.UTMCampaign,
		&lead.CreatedAt, &lead.UpdatedAt)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not save lead")
		return
	}

	// Resolve the visitor's locale from the request: explicit body field
	// (forwarded by the contact form), falling back to Accept-Language.
	visitorLocale := normaliseLocale(req.Locale)
	if visitorLocale == "en" {
		// If the body didn't set it, peek at the header.
		visitorLocale = localeFromHeader(r.Header.Get("Accept-Language"))
	}

	go h.dispatchNotifications(lead, visitorLocale)

	writeJSON(w, http.StatusCreated, lead)
}

// normaliseLocale is the lead-api copy of the same whitelist used elsewhere.
func normaliseLocale(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "th":
		return "th"
	default:
		return "en"
	}
}

func localeFromHeader(h string) string {
	if h == "" {
		return "en"
	}
	first := strings.SplitN(h, ",", 2)[0]
	first = strings.SplitN(first, ";", 2)[0]
	first = strings.SplitN(first, "-", 2)[0]
	return normaliseLocale(first)
}

// dispatchNotifications fires two emails: one to sales (always EN — internal),
// one to the visitor (in their browsing locale). Best-effort — never blocks.
func (h *LeadHandler) dispatchNotifications(lead models.Lead, visitorLocale string) {
	type notifyReq struct {
		Channel       string         `json:"channel"`
		Template      string         `json:"template"`
		ToAddress     string         `json:"to_address"`
		Payload       map[string]any `json:"payload"`
		RelatedLeadID string         `json:"related_lead_id"`
		Locale        string         `json:"locale"`
	}

	send := func(req notifyReq) {
		body, _ := json.Marshal(req)
		client := &http.Client{Timeout: 5 * time.Second}
		_, _ = client.Post(
			h.Cfg.NotificationAPIURL+"/api/notifications",
			"application/json",
			bytes.NewReader(body),
		)
	}

	payload := map[string]any{
		"full_name":     lead.FullName,
		"email":         lead.Email,
		"phone":         deref(lead.Phone),
		"company":       deref(lead.Company),
		"property_name": deref(lead.PropertyName),
		"property_type": deref(lead.PropertyType),
		"interest":      strings.Join(lead.Interest, ", "),
		"message":       lead.Message,
		"source":        lead.Source,
	}

	// F2 staff alert always in English (operational tool).
	send(notifyReq{
		Channel: "email", Template: "lead_received_sales",
		ToAddress: h.Cfg.SalesNotifyTo, Payload: payload, RelatedLeadID: lead.ID,
		Locale: "en",
	})
	// Visitor acknowledgement in the locale they were browsing in.
	send(notifyReq{
		Channel: "email", Template: "lead_received_visitor",
		ToAddress: lead.Email, Payload: payload, RelatedLeadID: lead.ID,
		Locale: visitorLocale,
	})
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// ----- Admin endpoints (JWT-protected upstream) -----

func (h *LeadHandler) List(w http.ResponseWriter, r *http.Request) {
	rows, err := h.DB.Query(r.Context(), `
        SELECT id, full_name, email, phone, company, property_name, property_type,
               interest, message, source, status, utm_source, utm_medium, utm_campaign,
               created_at, updated_at
        FROM leads ORDER BY created_at DESC LIMIT 200
    `)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	out := make([]models.Lead, 0, 32)
	for rows.Next() {
		var l models.Lead
		if err := rows.Scan(&l.ID, &l.FullName, &l.Email, &l.Phone, &l.Company,
			&l.PropertyName, &l.PropertyType, &l.Interest, &l.Message,
			&l.Source, &l.Status, &l.UTMSource, &l.UTMMedium, &l.UTMCampaign,
			&l.CreatedAt, &l.UpdatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, l)
	}
	writeJSON(w, http.StatusOK, map[string]any{"leads": out})
}

func (h *LeadHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var l models.Lead
	err := h.DB.QueryRow(r.Context(), `
        SELECT id, full_name, email, phone, company, property_name, property_type,
               interest, message, source, status, utm_source, utm_medium, utm_campaign,
               created_at, updated_at
        FROM leads WHERE id = $1
    `, id).Scan(&l.ID, &l.FullName, &l.Email, &l.Phone, &l.Company,
		&l.PropertyName, &l.PropertyType, &l.Interest, &l.Message,
		&l.Source, &l.Status, &l.UTMSource, &l.UTMMedium, &l.UTMCampaign,
		&l.CreatedAt, &l.UpdatedAt)
	if err == pgx.ErrNoRows {
		writeErr(w, http.StatusNotFound, "lead not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	writeJSON(w, http.StatusOK, l)
}

type statusUpdateReq struct {
	Status string `json:"status"`
	Note   string `json:"note"`
}

var validLeadStatuses = map[string]struct{}{
	"new": {}, "contacted": {}, "qualified": {}, "won": {}, "lost": {}, "spam": {},
}

func (h *LeadHandler) UpdateStatus(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	actorID, _ := r.Context().Value(authmw.CtxUserID).(string)

	var req statusUpdateReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if _, ok := validLeadStatuses[req.Status]; !ok {
		writeErr(w, http.StatusBadRequest, "invalid status")
		return
	}

	// Read previous status for the activity payload.
	var prevStatus string
	if err := h.DB.QueryRow(r.Context(),
		`SELECT status FROM leads WHERE id = $1`, id).Scan(&prevStatus); err != nil {
		if err == pgx.ErrNoRows {
			writeErr(w, http.StatusNotFound, "lead not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if prevStatus == req.Status && strings.TrimSpace(req.Note) == "" {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "tx error")
		return
	}
	defer tx.Rollback(r.Context())

	if _, err := tx.Exec(r.Context(),
		`UPDATE leads SET status = $1 WHERE id = $2`, req.Status, id); err != nil {
		writeErr(w, http.StatusInternalServerError, "update error")
		return
	}

	payload := map[string]any{"from": prevStatus, "to": req.Status}
	if note := strings.TrimSpace(req.Note); note != "" {
		payload["note"] = note
	}
	body, _ := json.Marshal(payload)

	if _, err := tx.Exec(r.Context(), `
        INSERT INTO lead_activities (lead_id, actor_id, activity_type, payload)
        VALUES ($1, NULLIF($2,'')::uuid, 'status_change', $3::jsonb)
    `, id, actorID, body); err != nil {
		writeErr(w, http.StatusInternalServerError, "activity log error")
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ----- Activities timeline -----

type addNoteReq struct {
	Note string `json:"note"`
}

func (h *LeadHandler) AddNote(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	actorID, _ := r.Context().Value(authmw.CtxUserID).(string)

	var req addNoteReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	note := strings.TrimSpace(req.Note)
	if note == "" {
		writeErr(w, http.StatusBadRequest, "note is required")
		return
	}
	if len(note) > 5000 {
		writeErr(w, http.StatusBadRequest, "note too long")
		return
	}

	// Verify lead exists.
	var exists bool
	if err := h.DB.QueryRow(r.Context(),
		`SELECT EXISTS(SELECT 1 FROM leads WHERE id = $1)`, id).Scan(&exists); err != nil || !exists {
		writeErr(w, http.StatusNotFound, "lead not found")
		return
	}

	body, _ := json.Marshal(map[string]any{"note": note})
	if _, err := h.DB.Exec(r.Context(), `
        INSERT INTO lead_activities (lead_id, actor_id, activity_type, payload)
        VALUES ($1, NULLIF($2,'')::uuid, 'note', $3::jsonb)
    `, id, actorID, body); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not add note")
		return
	}
	w.WriteHeader(http.StatusCreated)
}

type Activity struct {
	ID           string          `json:"id"`
	LeadID       string          `json:"lead_id"`
	ActorID      *string         `json:"actor_id,omitempty"`
	ActorName    *string         `json:"actor_name,omitempty"`
	ActivityType string          `json:"activity_type"`
	Payload      json.RawMessage `json:"payload"`
	CreatedAt    time.Time       `json:"created_at"`
}

func (h *LeadHandler) ListActivities(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	rows, err := h.DB.Query(r.Context(), `
        SELECT a.id, a.lead_id, a.actor_id, u.full_name, a.activity_type, a.payload, a.created_at
        FROM lead_activities a
        LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.lead_id = $1
        ORDER BY a.created_at DESC
        LIMIT 200
    `, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	out := make([]Activity, 0, 16)
	for rows.Next() {
		var a Activity
		if err := rows.Scan(&a.ID, &a.LeadID, &a.ActorID, &a.ActorName,
			&a.ActivityType, &a.Payload, &a.CreatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, a)
	}
	writeJSON(w, http.StatusOK, map[string]any{"activities": out})
}

// RecentActivities returns the last N activities across all leads — for the
// admin dashboard "Recent activity" tile.
func (h *LeadHandler) RecentActivities(w http.ResponseWriter, r *http.Request) {
	rows, err := h.DB.Query(r.Context(), `
        SELECT a.id, a.lead_id, a.actor_id, u.full_name, a.activity_type, a.payload, a.created_at
        FROM lead_activities a
        LEFT JOIN users u ON u.id = a.actor_id
        ORDER BY a.created_at DESC
        LIMIT 10
    `)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	out := make([]Activity, 0, 10)
	for rows.Next() {
		var a Activity
		if err := rows.Scan(&a.ID, &a.LeadID, &a.ActorID, &a.ActorName,
			&a.ActivityType, &a.Payload, &a.CreatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, a)
	}
	writeJSON(w, http.StatusOK, map[string]any{"activities": out})
}

// Stats: counts for the dashboard tiles.
type leadStats struct {
	NewLast7Days int `json:"new_last_7_days"`
	OpenLeads    int `json:"open_leads"` // status IN (new, contacted, qualified)
	WonLast30    int `json:"won_last_30_days"`
}

func (h *LeadHandler) Stats(w http.ResponseWriter, r *http.Request) {
	var s leadStats
	err := h.DB.QueryRow(r.Context(), `
        SELECT
            (SELECT COUNT(*) FROM leads WHERE created_at > NOW() - INTERVAL '7 days'),
            (SELECT COUNT(*) FROM leads WHERE status IN ('new','contacted','qualified')),
            (SELECT COUNT(*) FROM leads WHERE status = 'won' AND updated_at > NOW() - INTERVAL '30 days')
    `).Scan(&s.NewLast7Days, &s.OpenLeads, &s.WonLast30)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	writeJSON(w, http.StatusOK, s)
}
