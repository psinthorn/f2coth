package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"github.com/f2cothai/f2-website/services/customer-api/internal/config"
	authmw "github.com/f2cothai/f2-website/services/customer-api/internal/middleware"
	"github.com/f2cothai/f2-website/services/customer-api/internal/models"
	"github.com/f2cothai/f2-website/services/customer-api/internal/notify"
)

type AdminHandler struct {
	DB     *pgxpool.Pool
	Cfg    config.Config
	Notify *notify.Client
}

func staffID(r *http.Request) string {
	v, _ := r.Context().Value(authmw.CtxUserID).(string)
	return v
}

// -------------------- Customers --------------------

// customerSelect is shared by List and Get so a column change only needs
// editing here. Keeps the two shapes from drifting (list showing extra
// fields the detail page doesn't, etc.).
const customerSelect = `
    SELECT c.id, c.slug, c.name, c.industry,
           c.primary_contact_name, c.primary_contact_email, c.primary_contact_phone,
           c.account_manager_id, u.full_name, u.email,
           c.services_used, c.notes, c.is_active, c.created_at, c.updated_at,
           c.show_on_website, c.website_display_name, c.website_logo_url,
           c.website_industry_label, c.website_industry_label_th,
           c.website_sort_order,
           c.consent_document_url, c.consent_granted_at, c.consent_granted_by,
           c.consent_expires_at, c.consent_notes
      FROM customers c
      LEFT JOIN users u ON u.id = c.account_manager_id`

func scanCustomer(row interface{ Scan(...any) error }, c *models.Customer) error {
	return row.Scan(&c.ID, &c.Slug, &c.Name, &c.Industry,
		&c.PrimaryContactName, &c.PrimaryContactEmail, &c.PrimaryContactPhone,
		&c.AccountManagerID, &c.AccountManagerName, &c.AccountManagerEmail,
		&c.ServicesUsed, &c.Notes, &c.IsActive, &c.CreatedAt, &c.UpdatedAt,
		&c.ShowOnWebsite, &c.WebsiteDisplayName, &c.WebsiteLogoURL,
		&c.WebsiteIndustryLabel, &c.WebsiteIndustryLabelTH,
		&c.WebsiteSortOrder,
		&c.ConsentDocumentURL, &c.ConsentGrantedAt, &c.ConsentGrantedBy,
		&c.ConsentExpiresAt, &c.ConsentNotes)
}

func (h *AdminHandler) ListCustomers(w http.ResponseWriter, r *http.Request) {
	rows, err := h.DB.Query(r.Context(),
		customerSelect+` ORDER BY c.is_active DESC, c.name`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	out := make([]models.Customer, 0, 16)
	for rows.Next() {
		var c models.Customer
		if err := scanCustomer(rows, &c); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, c)
	}
	writeJSON(w, http.StatusOK, map[string]any{"customers": out})
}

func (h *AdminHandler) GetCustomer(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var c models.Customer
	err := scanCustomer(
		h.DB.QueryRow(r.Context(), customerSelect+` WHERE c.id = $1`, id),
		&c,
	)
	if err == pgx.ErrNoRows {
		writeErr(w, http.StatusNotFound, "customer not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	writeJSON(w, http.StatusOK, c)
}

type customerCreateReq struct {
	Slug                string   `json:"slug"`
	Name                string   `json:"name"`
	Industry            string   `json:"industry"`
	PrimaryContactName  string   `json:"primary_contact_name"`
	PrimaryContactEmail string   `json:"primary_contact_email"`
	PrimaryContactPhone string   `json:"primary_contact_phone"`
	AccountManagerID    string   `json:"account_manager_id"`
	ServicesUsed        []string `json:"services_used"`
	Notes               string   `json:"notes"`
}

func (h *AdminHandler) CreateCustomer(w http.ResponseWriter, r *http.Request) {
	var req customerCreateReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.Slug = strings.TrimSpace(req.Slug)
	req.Name = strings.TrimSpace(req.Name)
	if req.Slug == "" || req.Name == "" {
		writeErr(w, http.StatusBadRequest, "slug and name are required")
		return
	}
	if req.ServicesUsed == nil {
		req.ServicesUsed = []string{}
	}

	var id string
	err := h.DB.QueryRow(r.Context(), `
        INSERT INTO customers (slug, name, industry,
                               primary_contact_name, primary_contact_email, primary_contact_phone,
                               account_manager_id, services_used, notes)
        VALUES ($1,$2,NULLIF($3,''),
                NULLIF($4,''),NULLIF($5,''),NULLIF($6,''),
                NULLIF($7,'')::uuid, $8, NULLIF($9,''))
        RETURNING id
    `, req.Slug, req.Name, req.Industry,
		req.PrimaryContactName, req.PrimaryContactEmail, req.PrimaryContactPhone,
		req.AccountManagerID, req.ServicesUsed, req.Notes).Scan(&id)
	if err != nil {
		if strings.Contains(err.Error(), "customers_slug_key") {
			writeErr(w, http.StatusConflict, "slug already in use")
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not create customer")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": id})
}

type customerUpdateReq struct {
	Name                *string   `json:"name"`
	Industry            *string   `json:"industry"`
	PrimaryContactName  *string   `json:"primary_contact_name"`
	PrimaryContactEmail *string   `json:"primary_contact_email"`
	PrimaryContactPhone *string   `json:"primary_contact_phone"`
	AccountManagerID    *string   `json:"account_manager_id"`
	ServicesUsed        *[]string `json:"services_used"`
	Notes               *string   `json:"notes"`
	IsActive            *bool     `json:"is_active"`
}

func (h *AdminHandler) UpdateCustomer(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req customerUpdateReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	tag, err := h.DB.Exec(r.Context(), `
        UPDATE customers SET
            name = COALESCE($2, name),
            industry = COALESCE($3, industry),
            primary_contact_name = COALESCE($4, primary_contact_name),
            primary_contact_email = COALESCE($5, primary_contact_email),
            primary_contact_phone = COALESCE($6, primary_contact_phone),
            account_manager_id = COALESCE(NULLIF($7,'')::uuid, account_manager_id),
            services_used = COALESCE($8, services_used),
            notes = COALESCE($9, notes),
            is_active = COALESCE($10, is_active)
        WHERE id = $1
    `, id, req.Name, req.Industry,
		req.PrimaryContactName, req.PrimaryContactEmail, req.PrimaryContactPhone,
		strPtr(req.AccountManagerID), req.ServicesUsed, req.Notes, req.IsActive)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "customer not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func strPtr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// -------------------- Customer contacts --------------------

// ListContacts returns every person who is a member of this org. Membership
// (contact_org_memberships) is the source of truth since migration 071 — a
// person may belong to several orgs, so we join through it and surface the
// per-org role + is_primary alongside the account-level lifecycle fields.
func (h *AdminHandler) ListContacts(w http.ResponseWriter, r *http.Request) {
	cid := chi.URLParam(r, "id")
	// disabled_at reflects this org's membership state (per-org disable), or the
	// account-level global kill-switch if that's set — whichever disables access.
	rows, err := h.DB.Query(r.Context(), `
        SELECT cc.id, m.customer_id, cc.email, cc.full_name, m.role,
               cc.last_login_at, COALESCE(m.disabled_at, cc.disabled_at), cc.created_at,
               cc.email_verified_at, cc.must_change_password,
               cc.phone, cc.job_title, m.is_primary
        FROM contact_org_memberships m
        JOIN customer_contacts cc ON cc.id = m.contact_id
        WHERE m.customer_id = $1
        ORDER BY (COALESCE(m.disabled_at, cc.disabled_at) IS NULL) DESC, cc.created_at DESC
    `, cid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	out := make([]models.Contact, 0, 8)
	for rows.Next() {
		var c models.Contact
		if err := rows.Scan(&c.ID, &c.CustomerID, &c.Email, &c.FullName, &c.Role,
			&c.LastLoginAt, &c.DisabledAt, &c.CreatedAt,
			&c.EmailVerifiedAt, &c.MustChangePassword,
			&c.Phone, &c.JobTitle, &c.IsPrimary); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, c)
	}
	writeJSON(w, http.StatusOK, map[string]any{"contacts": out})
}

type contactCreateReq struct {
	Email    string `json:"email"`
	FullName string `json:"full_name"`
	Role     string `json:"role"`
	Phone    string `json:"phone"`
	JobTitle string `json:"job_title"`
}

// CreateContact invites a person to this org by email (migration 071).
//
// The admin supplies only minimal info — no password. Because email is
// globally unique, this is a find-or-create-then-link:
//   - New person  → create the account with a generated temporary password
//     (must_change_password = TRUE), add a primary membership, mint an email
//     verification token, and send login instructions + a verify link.
//   - Existing person → add a membership to this org (no new password, no
//     temp-password email — they already have working credentials).
//
// Response: {id, linked: bool} — linked=true means an existing user was added.
func (h *AdminHandler) CreateContact(w http.ResponseWriter, r *http.Request) {
	cid := chi.URLParam(r, "id")
	var req contactCreateReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.FullName = strings.TrimSpace(req.FullName)
	if req.Email == "" || req.FullName == "" {
		writeErr(w, http.StatusBadRequest, "email and full_name required")
		return
	}
	if req.Role == "" {
		req.Role = "member"
	}
	if req.Role != "owner" && req.Role != "member" {
		writeErr(w, http.StatusBadRequest, "role must be owner or member")
		return
	}

	// Confirm the org exists and grab its name for the email.
	var orgName string
	if err := h.DB.QueryRow(r.Context(),
		`SELECT name FROM customers WHERE id = $1`, cid).Scan(&orgName); err != nil {
		writeErr(w, http.StatusNotFound, "customer not found")
		return
	}

	// Does this email already belong to someone?
	var (
		existingID       string
		existingLocale   string
		existingName     string
		existingVerified bool
	)
	err := h.DB.QueryRow(r.Context(),
		`SELECT id, COALESCE(locale,'en'), full_name, (email_verified_at IS NOT NULL)
		   FROM customer_contacts WHERE email = $1`,
		req.Email).Scan(&existingID, &existingLocale, &existingName, &existingVerified)

	if err == nil {
		// Existing person → link them to this org (idempotent). Detect whether
		// this actually added a membership so we don't re-notify on a no-op.
		tag, e := h.DB.Exec(r.Context(), `
            INSERT INTO contact_org_memberships (contact_id, customer_id, role, is_primary)
            VALUES ($1, $2, $3, FALSE)
            ON CONFLICT (contact_id, customer_id) DO NOTHING
        `, existingID, cid, req.Role)
		if e != nil {
			writeErr(w, http.StatusInternalServerError, "could not link contact")
			return
		}
		newlyLinked := tag.RowsAffected() > 0
		// Tell the user they were added to a new org. If they haven't verified
		// their email yet, send them a verification link so they're informed
		// and can complete verification.
		if newlyLinked && !existingVerified {
			rawToken, tokenHash, e := mintContactToken()
			if e == nil {
				if _, e := h.DB.Exec(r.Context(), `
                    INSERT INTO password_resets (contact_id, token_hash, expires_at, purpose)
                    VALUES ($1, $2, NOW() + ($3 || ' minutes')::interval, 'verification')
                `, existingID, tokenHash, verifyTTLMinutes); e == nil {
					h.sendVerifyEmail(req.Email, existingName, rawToken, existingLocale)
				}
			}
		}
		writeJSON(w, http.StatusCreated, map[string]any{"id": existingID, "linked": true, "newly_linked": newlyLinked})
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}

	// New person → create account with a temporary password.
	tempPassword, err := genTempPassword()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "password gen error")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(tempPassword), 12)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "hash error")
		return
	}

	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "tx error")
		return
	}
	defer tx.Rollback(r.Context())

	var id string
	err = tx.QueryRow(r.Context(), `
        INSERT INTO customer_contacts
            (customer_id, email, password_hash, full_name, role,
             phone, job_title, must_change_password, invited_at)
        VALUES ($1, $2, $3, $4, $5, NULLIF($6,''), NULLIF($7,''), TRUE, NOW())
        RETURNING id
    `, cid, req.Email, string(hash), req.FullName, req.Role, req.Phone, req.JobTitle).Scan(&id)
	if err != nil {
		if strings.Contains(err.Error(), "customer_contacts_email_key") {
			// Lost a race with a concurrent insert — treat as conflict.
			writeErr(w, http.StatusConflict, "email already in use")
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not create contact")
		return
	}
	if _, err := tx.Exec(r.Context(), `
        INSERT INTO contact_org_memberships (contact_id, customer_id, role, is_primary)
        VALUES ($1, $2, $3, TRUE)
        ON CONFLICT (contact_id, customer_id) DO NOTHING
    `, id, cid, req.Role); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create membership")
		return
	}
	// Mint an email-verification token inside the same tx.
	rawToken, tokenHash, err := mintContactToken()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "token error")
		return
	}
	if _, err := tx.Exec(r.Context(), `
        INSERT INTO password_resets (contact_id, token_hash, expires_at, purpose)
        VALUES ($1, $2, NOW() + ($3 || ' minutes')::interval, 'verification')
    `, id, tokenHash, verifyTTLMinutes); err != nil {
		writeErr(w, http.StatusInternalServerError, "token store error")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit error")
		return
	}

	// Send login instructions (temp password) + verification link. A brand-new
	// contact has no known locale yet, so "" → the sender defaults to EN.
	h.sendInviteEmail(req.Email, req.FullName, orgName, tempPassword, rawToken, "")

	writeJSON(w, http.StatusCreated, map[string]any{"id": id, "linked": false})
}

// DisableContact disables the person's access to THIS org only (per-org, via
// contact_org_memberships.disabled_at). A person who belongs to several orgs
// keeps access to the others — disabling from one org must never be a global
// lockout. Sessions currently active in this org are revoked.
func (h *AdminHandler) DisableContact(w http.ResponseWriter, r *http.Request) {
	cid := chi.URLParam(r, "id")
	contactID := chi.URLParam(r, "contactId")
	tag, err := h.DB.Exec(r.Context(), `
        UPDATE contact_org_memberships SET disabled_at = NOW()
        WHERE contact_id = $1 AND customer_id = $2 AND disabled_at IS NULL
    `, contactID, cid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "contact not found")
		return
	}
	// Revoke only the sessions currently scoped to this org.
	_, _ = h.DB.Exec(r.Context(),
		`UPDATE customer_refresh_tokens SET revoked_at = NOW()
         WHERE contact_id = $1 AND active_customer_id = $2 AND revoked_at IS NULL`, contactID, cid)
	w.WriteHeader(http.StatusNoContent)
}

func (h *AdminHandler) EnableContact(w http.ResponseWriter, r *http.Request) {
	cid := chi.URLParam(r, "id")
	contactID := chi.URLParam(r, "contactId")
	tag, err := h.DB.Exec(r.Context(), `
        UPDATE contact_org_memberships SET disabled_at = NULL
        WHERE contact_id = $1 AND customer_id = $2
    `, contactID, cid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "contact not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// -------------------- Staff-on-behalf ticket creation --------------------

type adminCreateTicketReq struct {
	Subject            string `json:"subject"`
	Body               string `json:"body"`
	Priority           string `json:"priority"`
	RelatedServiceSlug string `json:"related_service_slug"`
	// Optional resolution write-up (minimal markdown). Usually empty at
	// creation and filled in later as the ticket is worked.
	Solution string `json:"solution"`
	// Whether the solution may be shown to the customer once the ticket is
	// resolved/closed. Defaults false.
	SolutionShared bool `json:"solution_shared"`
	// Optional: which customer contact this ticket is being raised on behalf
	// of. If empty, the ticket is "F2-initiated" — opened_by_contact_id stays NULL.
	OpenedByContactID string `json:"opened_by_contact_id"`
	// Optional: assign immediately to the staff member opening the ticket.
	AssignToSelf bool `json:"assign_to_self"`
}

func (h *AdminHandler) CreateTicketForCustomer(w http.ResponseWriter, r *http.Request) {
	customerID := chi.URLParam(r, "id")
	uid := staffID(r)

	var req adminCreateTicketReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.Subject = strings.TrimSpace(req.Subject)
	req.Body = strings.TrimSpace(req.Body)
	req.Solution = strings.TrimSpace(req.Solution)
	if req.Subject == "" || req.Body == "" {
		writeErr(w, http.StatusBadRequest, "subject and body are required")
		return
	}
	if len(req.Subject) > 200 || len(req.Body) > 10000 || len(req.Solution) > 10000 {
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

	// Confirm the customer exists.
	var active bool
	if err := h.DB.QueryRow(r.Context(),
		`SELECT is_active FROM customers WHERE id = $1`, customerID).Scan(&active); err != nil {
		writeErr(w, http.StatusNotFound, "customer not found")
		return
	}

	// If opened_by_contact_id is set, verify it belongs to this customer.
	if req.OpenedByContactID != "" {
		var ok bool
		if err := h.DB.QueryRow(r.Context(),
			`SELECT EXISTS(SELECT 1 FROM customer_contacts WHERE id = $1 AND customer_id = $2)`,
			req.OpenedByContactID, customerID).Scan(&ok); err != nil || !ok {
			writeErr(w, http.StatusBadRequest, "contact does not belong to this customer")
			return
		}
	}

	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "tx error")
		return
	}
	defer tx.Rollback(r.Context())

	var ticketID string
	err = tx.QueryRow(r.Context(), `
        INSERT INTO tickets
            (customer_id, opened_by_contact_id, subject, priority,
             related_service_slug, assigned_to_user_id, status, solution, solution_shared)
        VALUES ($1, NULLIF($2,'')::uuid, $3, $4, NULLIF($5,''),
                CASE WHEN $6 THEN $7::uuid ELSE NULL END,
                'in_progress', $8, $9)
        RETURNING id
    `, customerID, req.OpenedByContactID, req.Subject, req.Priority,
		req.RelatedServiceSlug, req.AssignToSelf, uid, req.Solution, req.SolutionShared).Scan(&ticketID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create ticket")
		return
	}

	// Initial message authored by the staff member.
	if _, err := tx.Exec(r.Context(), `
        INSERT INTO ticket_messages (ticket_id, author_user_id, body, internal)
        VALUES ($1, $2, $3, FALSE)
    `, ticketID, uid, req.Body); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not save message")
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit error")
		return
	}

	// Always notify staff so the queue is observed; if a customer contact
	// was specified, also notify them with the on-behalf template.
	NotifyStaffOnNewTicket(h.DB, h.Cfg, h.Notify,
		ticketID, req.Subject, req.Body, req.Priority, req.RelatedServiceSlug)
	if req.OpenedByContactID != "" {
		NotifyCustomerOnStaffReply(h.DB, h.Cfg, h.Notify,
			ticketID, req.Body, h.lookupStaffName(uid), "ticket_opened_on_behalf_customer")
	}

	writeJSON(w, http.StatusCreated, map[string]string{"id": ticketID})
}

// lookupStaffName resolves the staff full_name for use in customer-facing
// notifications. Falls back to "F2" if anything goes wrong — never leaks.
func (h *AdminHandler) lookupStaffName(uid string) string {
	if uid == "" {
		return "F2"
	}
	ctx, cancel := makeCtx()
	defer cancel()
	var n string
	err := h.DB.QueryRow(ctx, `SELECT full_name FROM users WHERE id = $1`, uid).Scan(&n)
	if err != nil || n == "" {
		return "F2"
	}
	return n
}

// -------------------- Tickets (admin queue) --------------------

func (h *AdminHandler) ListTickets(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	q := `
        SELECT t.id, t.customer_id, c.name, t.opened_by_contact_id, cc.full_name,
               t.subject, t.status, t.priority,
               t.assigned_to_user_id, u.full_name,
               t.related_service_slug, t.last_activity_at, t.created_at, t.updated_at
        FROM tickets t
        JOIN customers c ON c.id = t.customer_id
        LEFT JOIN customer_contacts cc ON cc.id = t.opened_by_contact_id
        LEFT JOIN users u ON u.id = t.assigned_to_user_id
        WHERE ($1 = '' OR t.status = $1)
        ORDER BY
            CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
            t.last_activity_at DESC
        LIMIT 200
    `
	rows, err := h.DB.Query(r.Context(), q, status)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	out := make([]models.Ticket, 0, 16)
	for rows.Next() {
		var t models.Ticket
		if err := rows.Scan(&t.ID, &t.CustomerID, &t.CustomerName, &t.OpenedByContactID, &t.OpenedByName,
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

func (h *AdminHandler) GetTicket(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var t models.Ticket
	err := h.DB.QueryRow(r.Context(), `
        SELECT t.id, t.customer_id, c.name, t.opened_by_contact_id, cc.full_name,
               t.subject, t.status, t.priority,
               t.assigned_to_user_id, u.full_name,
               t.related_service_slug, t.solution, t.solution_shared, t.last_activity_at, t.created_at, t.updated_at
        FROM tickets t
        JOIN customers c ON c.id = t.customer_id
        LEFT JOIN customer_contacts cc ON cc.id = t.opened_by_contact_id
        LEFT JOIN users u ON u.id = t.assigned_to_user_id
        WHERE t.id = $1
    `, id).Scan(&t.ID, &t.CustomerID, &t.CustomerName, &t.OpenedByContactID, &t.OpenedByName,
		&t.Subject, &t.Status, &t.Priority,
		&t.AssignedToUserID, &t.AssignedToName,
		&t.RelatedServiceSlug, &t.Solution, &t.SolutionShared, &t.LastActivityAt, &t.CreatedAt, &t.UpdatedAt)
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

// Admin sees ALL messages including internal notes.
func (h *AdminHandler) ListAllMessages(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	rows, err := h.DB.Query(r.Context(), `
        SELECT m.id, m.ticket_id, m.author_user_id, m.author_contact_id,
               COALESCE(u.full_name, cc.full_name, 'System'),
               CASE WHEN m.author_user_id IS NOT NULL THEN 'staff' ELSE 'customer' END,
               m.body, m.internal, m.created_at
        FROM ticket_messages m
        LEFT JOIN users u ON u.id = m.author_user_id
        LEFT JOIN customer_contacts cc ON cc.id = m.author_contact_id
        WHERE m.ticket_id = $1
        ORDER BY m.created_at ASC
    `, id)
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

type adminMessageReq struct {
	Body     string `json:"body"`
	Internal bool   `json:"internal"`
}

func (h *AdminHandler) AddMessage(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	uid := staffID(r)
	var req adminMessageReq
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

	var exists bool
	if err := h.DB.QueryRow(r.Context(),
		`SELECT EXISTS(SELECT 1 FROM tickets WHERE id = $1)`, id).Scan(&exists); err != nil || !exists {
		writeErr(w, http.StatusNotFound, "ticket not found")
		return
	}

	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "tx error")
		return
	}
	defer tx.Rollback(r.Context())

	var msgID string
	if err := tx.QueryRow(r.Context(), `
        INSERT INTO ticket_messages (ticket_id, author_user_id, body, internal)
        VALUES ($1, $2, $3, $4)
        RETURNING id
    `, id, uid, body, req.Internal).Scan(&msgID); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not save message")
		return
	}
	// Only public replies bump last_activity_at.
	if !req.Internal {
		if _, err := tx.Exec(r.Context(),
			`UPDATE tickets SET last_activity_at = NOW(),
                                 status = CASE WHEN status = 'waiting_customer' THEN 'waiting_customer' ELSE 'in_progress' END
              WHERE id = $1`, id); err != nil {
			writeErr(w, http.StatusInternalServerError, "could not update ticket")
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit error")
		return
	}

	// Notify customer only on public (non-internal) replies.
	if !req.Internal {
		NotifyCustomerOnStaffReply(h.DB, h.Cfg, h.Notify,
			id, body, h.lookupStaffName(uid), "ticket_reply_customer")
	}

	writeJSON(w, http.StatusCreated, map[string]string{"id": msgID})
}

type adminTicketUpdateReq struct {
	Status           *string `json:"status"`
	Priority         *string `json:"priority"`
	AssignedToUserID *string `json:"assigned_to_user_id"`
	// Resolution write-up (minimal markdown). Pointer so an omitted field
	// leaves the stored value untouched; an explicit "" clears it.
	Solution *string `json:"solution"`
	// Share-with-customer toggle for the solution. Pointer so omitting it
	// leaves the current setting untouched.
	SolutionShared *bool `json:"solution_shared"`
}

var validTicketStatuses = map[string]struct{}{
	"open": {}, "in_progress": {}, "waiting_customer": {}, "resolved": {}, "closed": {},
}

func (h *AdminHandler) UpdateTicket(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req adminTicketUpdateReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Status != nil {
		if _, ok := validTicketStatuses[*req.Status]; !ok {
			writeErr(w, http.StatusBadRequest, "invalid status")
			return
		}
	}
	if req.Priority != nil {
		if _, ok := validPriorities[*req.Priority]; !ok {
			writeErr(w, http.StatusBadRequest, "invalid priority")
			return
		}
	}
	if req.Solution != nil {
		*req.Solution = strings.TrimSpace(*req.Solution)
		if len(*req.Solution) > 10000 {
			writeErr(w, http.StatusBadRequest, "solution too long")
			return
		}
	}
	tag, err := h.DB.Exec(r.Context(), `
        UPDATE tickets SET
            status = COALESCE($2, status),
            priority = COALESCE($3, priority),
            assigned_to_user_id = COALESCE(NULLIF($4,'')::uuid, assigned_to_user_id),
            solution = COALESCE($5, solution),
            solution_shared = COALESCE($6, solution_shared),
            last_activity_at = NOW()
        WHERE id = $1
    `, id, req.Status, req.Priority, strPtr(req.AssignedToUserID), req.Solution, req.SolutionShared)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "ticket not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Stats for admin dashboard tiles.
type ticketStats struct {
	Open       int `json:"open"`
	InProgress int `json:"in_progress"`
	Waiting    int `json:"waiting_customer"`
	UrgentOpen int `json:"urgent_open"`
}

func (h *AdminHandler) TicketStats(w http.ResponseWriter, r *http.Request) {
	var s ticketStats
	err := h.DB.QueryRow(r.Context(), `
        SELECT
          (SELECT COUNT(*) FROM tickets WHERE status = 'open'),
          (SELECT COUNT(*) FROM tickets WHERE status = 'in_progress'),
          (SELECT COUNT(*) FROM tickets WHERE status = 'waiting_customer'),
          (SELECT COUNT(*) FROM tickets WHERE status IN ('open','in_progress') AND priority = 'urgent')
    `).Scan(&s.Open, &s.InProgress, &s.Waiting, &s.UrgentOpen)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	writeJSON(w, http.StatusOK, s)
}
