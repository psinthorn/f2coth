package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/f2cothai/f2-website/services/customer-api/internal/config"
	authmw "github.com/f2cothai/f2-website/services/customer-api/internal/middleware"
	"github.com/f2cothai/f2-website/services/customer-api/internal/models"
	"github.com/f2cothai/f2-website/services/customer-api/internal/notify"
)

type PortalHandler struct {
	DB     *pgxpool.Pool
	Cfg    config.Config
	Notify *notify.Client
}

// customerID pulls the customer_id from JWT context. Every portal query
// MUST filter by this — it's the cross-tenant isolation boundary.
func customerID(r *http.Request) string {
	v, _ := r.Context().Value(authmw.CtxCustomerID).(string)
	return v
}

func contactID(r *http.Request) string {
	v, _ := r.Context().Value(authmw.CtxContactID).(string)
	return v
}

// ----- /portal/me -----

type meResp struct {
	Contact  models.Contact  `json:"contact"`
	Customer models.Customer `json:"customer"`
}

func (h *PortalHandler) Me(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	conid := contactID(r)
	if cid == "" || conid == "" {
		writeErr(w, http.StatusUnauthorized, "no customer in token")
		return
	}

	var c models.Contact
	err := h.DB.QueryRow(r.Context(), `
        SELECT id, customer_id, email, full_name, role, last_login_at, disabled_at, created_at
        FROM customer_contacts WHERE id = $1 AND customer_id = $2 AND disabled_at IS NULL
    `, conid, cid).Scan(&c.ID, &c.CustomerID, &c.Email, &c.FullName, &c.Role,
		&c.LastLoginAt, &c.DisabledAt, &c.CreatedAt)
	if err == pgx.ErrNoRows {
		writeErr(w, http.StatusUnauthorized, "contact not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}

	cust, err := h.loadCustomer(r, cid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}

	writeJSON(w, http.StatusOK, meResp{Contact: c, Customer: cust})
}

func (h *PortalHandler) loadCustomer(r *http.Request, cid string) (models.Customer, error) {
	var c models.Customer
	err := h.DB.QueryRow(r.Context(), `
        SELECT c.id, c.slug, c.name, c.industry,
               c.primary_contact_name, c.primary_contact_email, c.primary_contact_phone,
               c.account_manager_id, u.full_name, u.email,
               c.services_used, c.notes, c.is_active,
               c.created_at, c.updated_at
        FROM customers c
        LEFT JOIN users u ON u.id = c.account_manager_id
        WHERE c.id = $1 AND c.is_active = TRUE
    `, cid).Scan(&c.ID, &c.Slug, &c.Name, &c.Industry,
		&c.PrimaryContactName, &c.PrimaryContactEmail, &c.PrimaryContactPhone,
		&c.AccountManagerID, &c.AccountManagerName, &c.AccountManagerEmail,
		&c.ServicesUsed, &c.Notes, &c.IsActive,
		&c.CreatedAt, &c.UpdatedAt)
	return c, err
}

// ----- /portal/tickets -----

func (h *PortalHandler) ListTickets(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	rows, err := h.DB.Query(r.Context(), `
        SELECT t.id, t.customer_id, t.opened_by_contact_id, cc.full_name,
               t.subject, t.status, t.priority,
               t.assigned_to_user_id, u.full_name,
               t.related_service_slug, t.last_activity_at, t.created_at, t.updated_at
        FROM tickets t
        LEFT JOIN customer_contacts cc ON cc.id = t.opened_by_contact_id
        LEFT JOIN users u ON u.id = t.assigned_to_user_id
        WHERE t.customer_id = $1
        ORDER BY t.last_activity_at DESC
        LIMIT 100
    `, cid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	out := make([]models.Ticket, 0, 16)
	for rows.Next() {
		var t models.Ticket
		if err := rows.Scan(&t.ID, &t.CustomerID, &t.OpenedByContactID, &t.OpenedByName,
			&t.Subject, &t.Status, &t.Priority,
			&t.AssignedToUserID, &t.AssignedToName,
			&t.RelatedServiceSlug, &t.LastActivityAt, &t.CreatedAt, &t.UpdatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, t)
	}
	writeJSON(w, http.StatusOK, map[string]any{"tickets": out})
}

type createTicketReq struct {
	Subject            string `json:"subject"`
	Body               string `json:"body"`
	Priority           string `json:"priority"`
	RelatedServiceSlug string `json:"related_service_slug"`
}

var validPriorities = map[string]struct{}{"low": {}, "normal": {}, "high": {}, "urgent": {}}

func (h *PortalHandler) CreateTicket(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	conid := contactID(r)

	var req createTicketReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.Subject = strings.TrimSpace(req.Subject)
	req.Body = strings.TrimSpace(req.Body)
	if req.Subject == "" || req.Body == "" {
		writeErr(w, http.StatusBadRequest, "subject and body are required")
		return
	}
	if len(req.Subject) > 200 || len(req.Body) > 10000 {
		writeErr(w, http.StatusBadRequest, "input too long")
		return
	}
	if req.Priority == "" {
		req.Priority = "normal"
	}
	if _, ok := validPriorities[req.Priority]; !ok {
		writeErr(w, http.StatusBadRequest, "invalid priority")
		return
	}

	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "tx error")
		return
	}
	defer tx.Rollback(r.Context())

	var ticketID string
	err = tx.QueryRow(r.Context(), `
        INSERT INTO tickets (customer_id, opened_by_contact_id, subject, priority, related_service_slug)
        VALUES ($1, $2, $3, $4, NULLIF($5,''))
        RETURNING id
    `, cid, conid, req.Subject, req.Priority, req.RelatedServiceSlug).Scan(&ticketID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create ticket")
		return
	}
	if _, err := tx.Exec(r.Context(), `
        INSERT INTO ticket_messages (ticket_id, author_contact_id, body, internal)
        VALUES ($1, $2, $3, FALSE)
    `, ticketID, conid, req.Body); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not save message")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit error")
		return
	}

	// Best-effort: email staff that a new ticket arrived.
	NotifyStaffOnNewTicket(h.DB, h.Cfg, h.Notify, ticketID, req.Subject, req.Body, req.Priority, req.RelatedServiceSlug)

	writeJSON(w, http.StatusCreated, map[string]string{"id": ticketID})
}

func (h *PortalHandler) GetTicket(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	id := chi.URLParam(r, "id")

	var t models.Ticket
	err := h.DB.QueryRow(r.Context(), `
        SELECT t.id, t.customer_id, t.opened_by_contact_id, cc.full_name,
               t.subject, t.status, t.priority,
               t.assigned_to_user_id, u.full_name,
               t.related_service_slug, t.last_activity_at, t.created_at, t.updated_at
        FROM tickets t
        LEFT JOIN customer_contacts cc ON cc.id = t.opened_by_contact_id
        LEFT JOIN users u ON u.id = t.assigned_to_user_id
        WHERE t.id = $1 AND t.customer_id = $2
    `, id, cid).Scan(&t.ID, &t.CustomerID, &t.OpenedByContactID, &t.OpenedByName,
		&t.Subject, &t.Status, &t.Priority,
		&t.AssignedToUserID, &t.AssignedToName,
		&t.RelatedServiceSlug, &t.LastActivityAt, &t.CreatedAt, &t.UpdatedAt)
	if err == pgx.ErrNoRows {
		writeErr(w, http.StatusNotFound, "ticket not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (h *PortalHandler) ListMessages(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	id := chi.URLParam(r, "id")

	rows, err := h.DB.Query(r.Context(), `
        SELECT m.id, m.ticket_id, m.author_user_id, m.author_contact_id,
               COALESCE(u.full_name, cc.full_name, 'System'),
               CASE WHEN m.author_user_id IS NOT NULL THEN 'staff' ELSE 'customer' END,
               m.body, m.internal, m.created_at
        FROM ticket_messages m
        JOIN tickets t ON t.id = m.ticket_id
        LEFT JOIN users u ON u.id = m.author_user_id
        LEFT JOIN customer_contacts cc ON cc.id = m.author_contact_id
        WHERE m.ticket_id = $1 AND t.customer_id = $2 AND m.internal = FALSE
        ORDER BY m.created_at ASC
    `, id, cid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	out := make([]models.TicketMessage, 0, 16)
	for rows.Next() {
		var m models.TicketMessage
		if err := rows.Scan(&m.ID, &m.TicketID, &m.AuthorUserID, &m.AuthorContactID,
			&m.AuthorName, &m.AuthorKind, &m.Body, &m.Internal, &m.CreatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, m)
	}
	writeJSON(w, http.StatusOK, map[string]any{"messages": out})
}

type addMessageReq struct {
	Body string `json:"body"`
}

func (h *PortalHandler) AddMessage(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	conid := contactID(r)
	id := chi.URLParam(r, "id")

	var req addMessageReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	body := strings.TrimSpace(req.Body)
	if body == "" {
		writeErr(w, http.StatusBadRequest, "body is required")
		return
	}
	if len(body) > 10000 {
		writeErr(w, http.StatusBadRequest, "body too long")
		return
	}

	var status string
	err := h.DB.QueryRow(r.Context(),
		`SELECT status FROM tickets WHERE id = $1 AND customer_id = $2`, id, cid).Scan(&status)
	if err == pgx.ErrNoRows {
		writeErr(w, http.StatusNotFound, "ticket not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if status == "closed" {
		writeErr(w, http.StatusBadRequest, "cannot reply on a closed ticket")
		return
	}

	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "tx error")
		return
	}
	defer tx.Rollback(r.Context())

	if _, err := tx.Exec(r.Context(), `
        INSERT INTO ticket_messages (ticket_id, author_contact_id, body, internal)
        VALUES ($1, $2, $3, FALSE)
    `, id, conid, body); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not save message")
		return
	}
	if _, err := tx.Exec(r.Context(),
		`UPDATE tickets SET last_activity_at = NOW() WHERE id = $1`, id); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not update ticket")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit error")
		return
	}

	// Best-effort: email staff that the customer replied.
	NotifyStaffOnCustomerReply(h.DB, h.Cfg, h.Notify, id, body)

	w.WriteHeader(http.StatusCreated)
}

type statusReq struct {
	Status string `json:"status"`
}

func (h *PortalHandler) UpdateStatus(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	id := chi.URLParam(r, "id")

	var req statusReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Status != "resolved" && req.Status != "open" {
		writeErr(w, http.StatusBadRequest, "customers may only mark resolved or reopen")
		return
	}
	tag, err := h.DB.Exec(r.Context(),
		`UPDATE tickets SET status = $1, last_activity_at = NOW()
         WHERE id = $2 AND customer_id = $3 AND status <> 'closed'`,
		req.Status, id, cid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "ticket not found or already closed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ============================================================================
// Notification helpers — used by both portal & admin handlers. Best-effort:
// failures are logged inside notify.Client and never block the user-facing
// response. We always run them in the foreground here because notify.Send
// itself dispatches in a goroutine.
// ============================================================================

// NotifyStaffOnNewTicket emails the assignee (or sales fallback) when a
// ticket is created — either by a customer via the portal or by staff via
// the on-behalf-of flow.
func NotifyStaffOnNewTicket(
	db *pgxpool.Pool, cfg config.Config, n *notify.Client,
	ticketID, subject, body, priority, service string,
) {
	if n == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	var (
		customerName   string
		openedBy       *string
		assigneeMail   *string
		assigneeLocale *string
	)
	err := db.QueryRow(ctx, `
        SELECT c.name,
               cc.full_name,
               u.email,
               u.locale
        FROM tickets t
        JOIN customers c ON c.id = t.customer_id
        LEFT JOIN customer_contacts cc ON cc.id = t.opened_by_contact_id
        LEFT JOIN users u ON u.id = t.assigned_to_user_id
        WHERE t.id = $1
    `, ticketID).Scan(&customerName, &openedBy, &assigneeMail, &assigneeLocale)
	if err != nil {
		return
	}
	to := cfg.SalesNotifyTo
	loc := "en"
	if assigneeMail != nil && *assigneeMail != "" {
		to = *assigneeMail
		if assigneeLocale != nil {
			loc = *assigneeLocale
		}
	}
	openerName := "F2 (initiated)"
	if openedBy != nil && *openedBy != "" {
		openerName = *openedBy
	}
	n.Send(notify.Job{
		Channel:   "email",
		Template:  "ticket_received_staff",
		ToAddress: to,
		Locale:    loc,
		Payload: map[string]any{
			"customer_name": customerName,
			"opened_by":     openerName,
			"subject":       subject,
			"body":          truncate(body, 800),
			"priority":      priority,
			"service":       valueOr(service, "(none)"),
			"ticket_url":    fmt.Sprintf("%s/admin/tickets/%s", cfg.AdminBaseURL, ticketID),
		},
	})
}

// NotifyStaffOnCustomerReply alerts the assignee when the customer adds a
// new message to an existing ticket.
func NotifyStaffOnCustomerReply(
	db *pgxpool.Pool, cfg config.Config, n *notify.Client,
	ticketID, body string,
) {
	if n == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	var (
		subject        string
		customerName   string
		assigneeMail   *string
		assigneeLocale *string
	)
	err := db.QueryRow(ctx, `
        SELECT t.subject, c.name, u.email, u.locale
        FROM tickets t
        JOIN customers c ON c.id = t.customer_id
        LEFT JOIN users u ON u.id = t.assigned_to_user_id
        WHERE t.id = $1
    `, ticketID).Scan(&subject, &customerName, &assigneeMail, &assigneeLocale)
	if err != nil {
		return
	}
	to := cfg.SalesNotifyTo
	loc := "en"
	if assigneeMail != nil && *assigneeMail != "" {
		to = *assigneeMail
		if assigneeLocale != nil {
			loc = *assigneeLocale
		}
	}
	n.Send(notify.Job{
		Channel:   "email",
		Template:  "ticket_received_staff",
		ToAddress: to,
		Locale:    loc,
		Payload: map[string]any{
			"customer_name": customerName,
			"opened_by":     "(customer reply)",
			"subject":       "Reply: " + subject,
			"body":          truncate(body, 800),
			"priority":      "normal",
			"service":       "(see ticket)",
			"ticket_url":    fmt.Sprintf("%s/admin/tickets/%s", cfg.AdminBaseURL, ticketID),
		},
	})
}

// NotifyCustomerOnStaffReply emails the ticket opener when staff replies
// (with internal=false). We pull the contact email from the ticket's
// opened_by_contact_id; if that's null (staff-initiated ticket), we fall
// back to the customer's primary_contact_email.
func NotifyCustomerOnStaffReply(
	db *pgxpool.Pool, cfg config.Config, n *notify.Client,
	ticketID, body, authorName, templateCode string,
) {
	if n == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	var (
		subject       string
		contactName   *string
		contactEmail  *string
		contactLocale *string
		fallbackName  *string
		fallbackMail  *string
	)
	err := db.QueryRow(ctx, `
        SELECT t.subject,
               cc.full_name, cc.email, cc.locale,
               c.primary_contact_name, c.primary_contact_email
        FROM tickets t
        JOIN customers c ON c.id = t.customer_id
        LEFT JOIN customer_contacts cc ON cc.id = t.opened_by_contact_id
        WHERE t.id = $1
    `, ticketID).Scan(&subject, &contactName, &contactEmail, &contactLocale, &fallbackName, &fallbackMail)
	if err != nil {
		return
	}

	to := ""
	name := ""
	loc := "en"
	if contactEmail != nil && *contactEmail != "" {
		to = *contactEmail
		if contactName != nil {
			name = *contactName
		}
		if contactLocale != nil {
			loc = *contactLocale
		}
	} else if fallbackMail != nil && *fallbackMail != "" {
		to = *fallbackMail
		if fallbackName != nil {
			name = *fallbackName
		}
	}
	if to == "" {
		return // no addressable customer
	}
	if name == "" {
		name = "there"
	}
	if templateCode == "" {
		templateCode = "ticket_reply_customer"
	}
	n.Send(notify.Job{
		Channel:   "email",
		Template:  templateCode,
		ToAddress: to,
		Locale:    loc,
		Payload: map[string]any{
			"contact_name": name,
			"author_name":  authorName,
			"subject":      subject,
			"body":         truncate(body, 800),
			"ticket_url":   fmt.Sprintf("%s/portal/tickets/%s", cfg.PortalBaseURL, ticketID),
		},
	})
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

func valueOr(s, def string) string {
	if strings.TrimSpace(s) == "" {
		return def
	}
	return s
}
