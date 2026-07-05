package handlers

// Weekly summary email dispatcher.
//
// POST /api/checklists/admin/projects/{id}/send-weekly-summary
//
// Admin-triggered today. A cron scheduler (Traefik + a small ticker
// service, or the payment-api scheduler pattern) can hit this same
// endpoint every Friday — kept as a plain HTTP call so scheduling is
// decoupled from delivery.
//
// Flow:
//  1. Load project + confirm it's active
//  2. Load progress totals for the week window (uses reportWindow from reports.go)
//  3. Find the primary customer_contacts row for the linked customer
//  4. Enqueue email via notification-api (template project_weekly_summary)
//
// Emails only fire when:
//   - project has a linked customer_id
//   - visible_to_customer = true
//   - the customer has at least one contact
//
// Fails loudly if any of those preconditions miss so the admin knows.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
)

func (h *Handler) SendWeeklySummary(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	p, err := loadProject(r.Context(), h, id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "project not found")
		return
	}
	if p.CustomerID == nil {
		writeErr(w, http.StatusBadRequest, "project has no linked customer — link one first")
		return
	}
	if !p.VisibleToCustomer {
		writeErr(w, http.StatusBadRequest, "project is hidden from customer — cannot email")
		return
	}

	// Primary contact for the customer. Prefer owner role, fall back to
	// any active contact so single-contact customers still get the email.
	// `disabled_at IS NULL` is the customer_contacts convention (see 009).
	var contactEmail, contactName, contactLocale string
	err = h.DB.QueryRow(r.Context(), `
		SELECT email, full_name, COALESCE(locale, 'en')
		  FROM customer_contacts
		 WHERE customer_id = $1 AND disabled_at IS NULL
		 ORDER BY (role = 'owner') DESC, created_at ASC
		 LIMIT 1`, *p.CustomerID).Scan(&contactEmail, &contactName, &contactLocale)
	if err != nil {
		writeErr(w, http.StatusNotFound, "no active contact for this customer")
		return
	}

	// Week window (this-week or the week containing an optional ?date=).
	rng, from, to := reportWindow("weekly", r.URL.Query().Get("date"), time.Now())

	// Totals across the whole project (not just the window — the email
	// summarises overall progress and notes this-week's changes).
	var total, done, pass, fail, na, pending int
	if err := h.DB.QueryRow(r.Context(), `
		SELECT COUNT(pi.id),
		       COUNT(*) FILTER (WHERE pi.status IN ('pass','fail','na')),
		       COUNT(*) FILTER (WHERE pi.status = 'pass'),
		       COUNT(*) FILTER (WHERE pi.status = 'fail'),
		       COUNT(*) FILTER (WHERE pi.status = 'na'),
		       COUNT(*) FILTER (WHERE pi.status = 'pending')
		  FROM project_items pi
		  JOIN project_modules pm ON pm.id = pi.project_module_id
		 WHERE pm.project_id = $1`, id).Scan(&total, &done, &pass, &fail, &na, &pending); err != nil {
		writeErr(w, http.StatusInternalServerError, "totals error")
		return
	}

	// This-week item changes for the summary_line teaser.
	var changesThisWeek int
	_ = h.DB.QueryRow(r.Context(), `
		SELECT COUNT(*) FROM project_items pi
		  JOIN project_modules pm ON pm.id = pi.project_module_id
		 WHERE pm.project_id = $1
		   AND pi.checked_at >= $2 AND pi.checked_at <= $3`,
		id, from, to).Scan(&changesThisWeek)
	summaryLine := fmt.Sprintf("%d items were updated this week (%s → %s).",
		changesThisWeek, from.Format("2006-01-02"), to.Format("2006-01-02"))
	if contactLocale == "th" {
		summaryLine = fmt.Sprintf("มีการอัปเดต %d รายการในสัปดาห์นี้ (%s → %s)",
			changesThisWeek, from.Format("2006-01-02"), to.Format("2006-01-02"))
	}

	// notification-api's Enqueue endpoint uses moustache-style {{keys}}
	// against the template stored in the DB (see 041 seed).
	payload := map[string]any{
		"contact_name":  contactName,
		"project_name":  p.Name,
		"total":         total,
		"done":          done,
		"pass":          pass,
		"fail":          fail,
		"na":            na,
		"pending":       pending,
		"summary_line":  summaryLine,
		"report_url":    portalReportURL(id),
	}
	subject := fmt.Sprintf("[F2] Weekly update — %s", p.Name)
	if contactLocale == "th" {
		subject = fmt.Sprintf("[F2] อัปเดตประจำสัปดาห์ — %s", p.Name)
	}

	if err := enqueueEmail(r.Context(), enqueueBody{
		Channel:   "email",
		Template:  "project_weekly_summary",
		ToAddress: contactEmail,
		Subject:   subject,
		Payload:   payload,
		Locale:    contactLocale,
	}); err != nil {
		writeErr(w, http.StatusBadGateway, "notification-api error: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"sent_to":       contactEmail,
		"range":         rng,
		"from":          from,
		"to":            to,
		"items_updated": changesThisWeek,
	})
}

// portalReportURL builds the customer-facing URL. Env-driven because
// staging + prod hit different hosts; falls back to a localhost path
// so dev works out of the box.
func portalReportURL(projectID string) string {
	base := os.Getenv("SITE_URL")
	if base == "" {
		base = "http://localhost"
	}
	return fmt.Sprintf("%s/portal/projects/%s", base, projectID)
}

// ── notification-api client ────────────────────────────────────────────

type enqueueBody struct {
	Channel   string         `json:"channel"`
	Template  string         `json:"template"`
	ToAddress string         `json:"to_address"`
	Subject   string         `json:"subject"`
	Payload   map[string]any `json:"payload"`
	Locale    string         `json:"locale"`
}

func enqueueEmail(ctx context.Context, body enqueueBody) error {
	base := os.Getenv("NOTIFY_URL")
	if base == "" {
		// docker-compose service DNS.
		base = "http://notification-api:8005"
	}
	buf, err := json.Marshal(body)
	if err != nil {
		return err
	}
	// notification-api's Enqueue lives at POST /api/notifications/ (trailing
	// slash — chi.Route("/api/notifications", ...) + Post("/", ...)).
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/api/notifications/", bytes.NewReader(buf))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 5 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 400 {
		return fmt.Errorf("notification-api %d", res.StatusCode)
	}
	return nil
}
