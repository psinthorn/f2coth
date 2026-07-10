package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	mw "github.com/f2cothai/f2-website/services/contract-api/internal/middleware"
	"github.com/f2cothai/f2-website/services/contract-api/internal/models"
)

const contractCols = `c.id, c.doc_no, c.template_id, t.code, t.name, c.party_id,
	p.legal_name_en, c.project_id, c.merge_data, c.status,
	c.effective_date::text, c.end_date::text, c.fee_total, c.created_by,
	c.created_at, c.updated_at`

func scanContract(row pgx.Row) (models.Contract, error) {
	var c models.Contract
	err := row.Scan(&c.ID, &c.DocNo, &c.TemplateID, &c.TemplateCode, &c.TemplateName,
		&c.PartyID, &c.PartyName, &c.ProjectID, &c.MergeData, &c.Status,
		&c.EffectiveDate, &c.EndDate, &c.FeeTotal, &c.CreatedBy,
		&c.CreatedAt, &c.UpdatedAt)
	return c, err
}

// GET /api/contracts?status=&party=&customer=&expiring=30 — list/filter.
func (h *Handler) ListContracts(w http.ResponseWriter, r *http.Request) {
	q := `SELECT ` + contractCols + `
	        FROM contracts c
	        JOIN contract_templates t ON t.id = c.template_id
	        JOIN contract_parties p   ON p.id = c.party_id`
	conds := []string{}
	args := []any{}
	add := func(cond string, val any) {
		args = append(args, val)
		conds = append(conds, cond+"$"+strconv.Itoa(len(args)))
	}
	if s := r.URL.Query().Get("status"); s != "" {
		add("c.status = ", s)
	}
	if party := r.URL.Query().Get("party"); party != "" {
		add("c.party_id = ", party)
	}
	if cust := r.URL.Query().Get("customer"); cust != "" {
		add("p.customer_id = ", cust)
	}
	if exp := r.URL.Query().Get("expiring"); exp != "" {
		if days, err := strconv.Atoi(exp); err == nil && days > 0 {
			// Active contracts ending within N days (renewal reminder).
			// `$n * INTERVAL '1 day'` keeps $n a plain integer bind — avoids the
			// text-concat type ambiguity of `($n || ' days')::interval`.
			conds = append(conds, "c.status = 'active'",
				"c.end_date IS NOT NULL",
				"c.end_date <= CURRENT_DATE + ($"+strconv.Itoa(len(args)+1)+" * INTERVAL '1 day')")
			args = append(args, days)
		}
	}
	where := ""
	for i, cnd := range conds {
		if i == 0 {
			where = " WHERE " + cnd
		} else {
			where += " AND " + cnd
		}
	}
	rows, err := h.DB.Query(r.Context(), q+where+` ORDER BY c.created_at DESC`, args...)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error: "+err.Error())
		return
	}
	defer rows.Close()
	out := []models.Contract{}
	for rows.Next() {
		c, err := scanContract(rows)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, c)
	}
	writeJSON(w, http.StatusOK, map[string]any{"contracts": out})
}

// GET /api/contracts/{id} — full detail (party + files + timeline).
func (h *Handler) GetContract(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	c, err := h.loadContract(r.Context(), id)
	if err == pgx.ErrNoRows {
		writeErr(w, http.StatusNotFound, "contract not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if party, err := h.loadParty(r.Context(), c.PartyID); err == nil {
		c.Party = party
	}
	c.Files, _ = h.listFiles(r.Context(), id)
	c.Events, _ = h.listEvents(r.Context(), id)
	writeJSON(w, http.StatusOK, c)
}

func (h *Handler) loadContract(ctx context.Context, id string) (models.Contract, error) {
	return scanContract(h.DB.QueryRow(ctx, `SELECT `+contractCols+`
		FROM contracts c
		JOIN contract_templates t ON t.id = c.template_id
		JOIN contract_parties p   ON p.id = c.party_id
		WHERE c.id = $1`, id))
}

type contractCreateReq struct {
	TemplateID    string          `json:"template_id"`
	PartyID       string          `json:"party_id"`
	ProjectID     *string         `json:"project_id"`
	MergeData     json.RawMessage `json:"merge_data"`
	EffectiveDate *string         `json:"effective_date"`
	EndDate       *string         `json:"end_date"`
	FeeTotal      *float64        `json:"fee_total"`
}

// POST /api/contracts (staff) — creates a draft; allocates a doc-no safely.
func (h *Handler) CreateContract(w http.ResponseWriter, r *http.Request) {
	var req contractCreateReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.TemplateID == "" || req.PartyID == "" {
		writeErr(w, http.StatusBadRequest, "template_id and party_id required")
		return
	}
	if len(req.MergeData) == 0 {
		req.MergeData = json.RawMessage(`{}`)
	}

	// Look up the template's doc prefix.
	var prefix string
	if err := h.DB.QueryRow(r.Context(),
		`SELECT doc_prefix FROM contract_templates WHERE id = $1 AND is_active`, req.TemplateID).
		Scan(&prefix); err == pgx.ErrNoRows {
		writeErr(w, http.StatusBadRequest, "template not found or inactive")
		return
	} else if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}

	userID := mw.UserID(r.Context())
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "tx error")
		return
	}
	defer tx.Rollback(r.Context())

	docNo, err := allocateDocNo(r.Context(), tx, prefix, currentYear())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "doc-no allocation failed: "+err.Error())
		return
	}

	var id string
	err = tx.QueryRow(r.Context(), `
		INSERT INTO contracts
			(doc_no, template_id, party_id, project_id, merge_data, status,
			 effective_date, end_date, fee_total, created_by)
		VALUES ($1,$2,$3,$4,$5,'draft',
			NULLIF($6,'')::date, NULLIF($7,'')::date, $8, NULLIF($9,'')::uuid)
		RETURNING id`,
		docNo, req.TemplateID, req.PartyID, req.ProjectID, req.MergeData,
		derefStr(req.EffectiveDate), derefStr(req.EndDate), req.FeeTotal, userID).Scan(&id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error: "+err.Error())
		return
	}
	if err := recordStatusEvent(r.Context(), tx, id, "", "draft", "created", userID); err != nil {
		writeErr(w, http.StatusInternalServerError, "event error: "+err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit error: "+err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": id, "doc_no": docNo})
}

type contractUpdateReq struct {
	MergeData     json.RawMessage `json:"merge_data"`
	ProjectID     *string         `json:"project_id"`
	EffectiveDate *string         `json:"effective_date"`
	EndDate       *string         `json:"end_date"`
	FeeTotal      *float64        `json:"fee_total"`
}

// PATCH /api/contracts/{id} (staff) — merge data editable only while draft.
func (h *Handler) UpdateContract(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var status string
	if err := h.DB.QueryRow(r.Context(), `SELECT status FROM contracts WHERE id = $1`, id).
		Scan(&status); err == pgx.ErrNoRows {
		writeErr(w, http.StatusNotFound, "contract not found")
		return
	} else if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if status != "draft" {
		writeErr(w, http.StatusConflict, "contract can only be edited while in draft")
		return
	}
	var req contractUpdateReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	_, err := h.DB.Exec(r.Context(), `
		UPDATE contracts SET
			merge_data     = COALESCE($2, merge_data),
			project_id     = $3,
			effective_date = NULLIF($4,'')::date,
			end_date       = NULLIF($5,'')::date,
			fee_total      = $6
		 WHERE id = $1`,
		id, nullableJSON(req.MergeData), req.ProjectID,
		derefStr(req.EffectiveDate), derefStr(req.EndDate), req.FeeTotal)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

// DELETE /api/contracts/{id} (admin only) — cascades files + events.
func (h *Handler) DeleteContract(w http.ResponseWriter, r *http.Request) {
	ct, err := h.DB.Exec(r.Context(), `DELETE FROM contracts WHERE id = $1`, chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if ct.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "contract not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

type statusChangeReq struct {
	To            string  `json:"to"`
	Note          string  `json:"note"`
	EffectiveDate *string `json:"effective_date"`
	EndDate       *string `json:"end_date"`
}

// POST /api/contracts/{id}/status (staff) — server-enforced transition.
// Activating a contract (→ active) sets effective/end dates and queues an
// iACC invoice-draft in the outbox.
func (h *Handler) ChangeStatus(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req statusChangeReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.To == "" {
		writeErr(w, http.StatusBadRequest, "to status required")
		return
	}

	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "tx error")
		return
	}
	defer tx.Rollback(r.Context())

	var from, docNo string
	var feeTotal *float64
	var projectID *string
	if err := tx.QueryRow(r.Context(),
		`SELECT status, doc_no, fee_total, project_id FROM contracts WHERE id = $1 FOR UPDATE`, id).
		Scan(&from, &docNo, &feeTotal, &projectID); err == pgx.ErrNoRows {
		writeErr(w, http.StatusNotFound, "contract not found")
		return
	} else if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}

	if !CanTransition(from, req.To) {
		writeErr(w, http.StatusConflict, "illegal transition "+from+" → "+req.To)
		return
	}

	if req.To == "active" {
		if _, err := tx.Exec(r.Context(), `
			UPDATE contracts SET status = 'active',
				effective_date = COALESCE(NULLIF($2,'')::date, effective_date),
				end_date       = COALESCE(NULLIF($3,'')::date, end_date)
			 WHERE id = $1`, id, derefStr(req.EffectiveDate), derefStr(req.EndDate)); err != nil {
			writeErr(w, http.StatusInternalServerError, "db error: "+err.Error())
			return
		}
		if err := h.queueIACCDraft(r.Context(), tx, id, docNo, feeTotal, projectID); err != nil {
			writeErr(w, http.StatusInternalServerError, "outbox error: "+err.Error())
			return
		}
	} else {
		if _, err := tx.Exec(r.Context(), `UPDATE contracts SET status = $2 WHERE id = $1`, id, req.To); err != nil {
			writeErr(w, http.StatusInternalServerError, "db error: "+err.Error())
			return
		}
	}

	if err := recordStatusEvent(r.Context(), tx, id, from, req.To, req.Note, mw.UserID(r.Context())); err != nil {
		writeErr(w, http.StatusInternalServerError, "event error: "+err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit error: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": req.To})
}

// listEvents returns the status timeline for a contract, oldest first.
func (h *Handler) listEvents(ctx context.Context, contractID string) ([]models.StatusEvent, error) {
	rows, err := h.DB.Query(ctx, `
		SELECT id, contract_id, from_status, to_status, note, changed_by, created_at
		  FROM contract_status_events WHERE contract_id = $1 ORDER BY created_at`, contractID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.StatusEvent{}
	for rows.Next() {
		var e models.StatusEvent
		if err := rows.Scan(&e.ID, &e.ContractID, &e.FromStatus, &e.ToStatus,
			&e.Note, &e.ChangedBy, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, nil
}
