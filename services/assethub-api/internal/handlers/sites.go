package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	mw "github.com/f2cothai/f2-website/services/assethub-api/internal/middleware"
	"github.com/f2cothai/f2-website/services/assethub-api/internal/models"
)

// ListSites returns sites for a customer. Staff pass ?customer_id=; portal
// callers are scoped to their own customer via the JWT claim.
func (h *Handler) ListSites(w http.ResponseWriter, r *http.Request) {
	customerID := h.scopeCustomer(r)
	if customerID == "" {
		writeErr(w, http.StatusBadRequest, "customer_id required")
		return
	}
	rows, err := h.DB.Query(r.Context(), `
		SELECT id, customer_id, name, cidrs, notes, created_at, updated_at
		FROM assethub_sites WHERE customer_id = $1 ORDER BY name`, customerID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()
	out := []models.Site{}
	for rows.Next() {
		var s models.Site
		if err := rows.Scan(&s.ID, &s.CustomerID, &s.Name, &s.CIDRs, &s.Notes, &s.CreatedAt, &s.UpdatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan failed")
			return
		}
		out = append(out, s)
	}
	writeJSON(w, http.StatusOK, out)
}

type siteReq struct {
	CustomerID string   `json:"customer_id"`
	Name       string   `json:"name"`
	CIDRs      []string `json:"cidrs"`
	Notes      string   `json:"notes"`
}

// CreateSite (staff only).
func (h *Handler) CreateSite(w http.ResponseWriter, r *http.Request) {
	var req siteReq
	if err := decode(w, r, &req); err != nil {
		return
	}
	if req.CustomerID == "" || req.Name == "" {
		writeErr(w, http.StatusBadRequest, "customer_id and name required")
		return
	}
	if req.CIDRs == nil {
		req.CIDRs = []string{}
	}
	ctx := r.Context()
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer tx.Rollback(ctx)
	var id string
	if err := tx.QueryRow(ctx, `
		INSERT INTO assethub_sites (customer_id, name, cidrs, notes)
		VALUES ($1,$2,$3,$4) RETURNING id`,
		req.CustomerID, req.Name, req.CIDRs, nilIfEmpty(req.Notes)).Scan(&id); err != nil {
		writeErr(w, http.StatusInternalServerError, "insert failed")
		return
	}
	_ = writeAudit(ctx, tx, "assethub_site", id, mw.UserID(ctx), "create", map[string]any{"name": req.Name})
	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit failed")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": id})
}

// UpdateSite (staff only).
func (h *Handler) UpdateSite(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req siteReq
	if err := decode(w, r, &req); err != nil {
		return
	}
	if req.CIDRs == nil {
		req.CIDRs = []string{}
	}
	ctx := r.Context()
	tag, err := h.DB.Exec(ctx, `
		UPDATE assethub_sites SET name=$2, cidrs=$3, notes=$4 WHERE id=$1`,
		id, req.Name, req.CIDRs, nilIfEmpty(req.Notes))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "update failed")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "site not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": id})
}

// DeleteSite (admin only).
func (h *Handler) DeleteSite(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ctx := r.Context()
	tag, err := h.DB.Exec(ctx, `DELETE FROM assethub_sites WHERE id=$1`, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "delete failed")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "site not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- shared request helpers ----

// scopeCustomer returns the customer the request is scoped to: the JWT
// customer_id claim for portal callers, else the ?customer_id= query param
// for staff callers.
func (h *Handler) scopeCustomer(r *http.Request) string {
	if cid := mw.CustomerID(r.Context()); cid != "" {
		return cid
	}
	return r.URL.Query().Get("customer_id")
}

func decode(w http.ResponseWriter, r *http.Request, v any) error {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64*1024)).Decode(v); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON body")
		return err
	}
	return nil
}
