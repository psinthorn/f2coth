package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	mw "github.com/f2cothai/f2-website/services/assethub-api/internal/middleware"
	"github.com/f2cothai/f2-website/services/assethub-api/internal/models"
)

// ListGroups returns the workstation groups for a customer, each with a live
// member count. Staff pass ?customer_id=; portal callers are scoped by JWT.
func (h *Handler) ListGroups(w http.ResponseWriter, r *http.Request) {
	customerID := h.scopeCustomer(r)
	if customerID == "" {
		writeErr(w, http.StatusBadRequest, "customer_id required")
		return
	}
	rows, err := h.DB.Query(r.Context(), `
		SELECT g.id, g.customer_id, g.site_id, g.name, g.department, g.notes,
		       (SELECT count(*) FROM assethub_devices d WHERE d.group_id = g.id) AS member_count,
		       g.created_at, g.updated_at
		FROM assethub_asset_groups g
		WHERE g.customer_id = $1 ORDER BY g.department NULLS FIRST, g.name`, customerID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()
	out := []models.AssetGroup{}
	for rows.Next() {
		var g models.AssetGroup
		if err := rows.Scan(&g.ID, &g.CustomerID, &g.SiteID, &g.Name, &g.Department, &g.Notes,
			&g.MemberCount, &g.CreatedAt, &g.UpdatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan failed")
			return
		}
		out = append(out, g)
	}
	writeJSON(w, http.StatusOK, out)
}

type groupReq struct {
	CustomerID string `json:"customer_id"`
	SiteID     string `json:"site_id"`
	Name       string `json:"name"`
	Department string `json:"department"`
	Notes      string `json:"notes"`
}

// CreateGroup (staff only).
func (h *Handler) CreateGroup(w http.ResponseWriter, r *http.Request) {
	var req groupReq
	if err := decode(w, r, &req); err != nil {
		return
	}
	if req.CustomerID == "" || req.Name == "" {
		writeErr(w, http.StatusBadRequest, "customer_id and name required")
		return
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
		INSERT INTO assethub_asset_groups (customer_id, site_id, name, department, notes)
		VALUES ($1,$2,$3,$4,$5) RETURNING id`,
		req.CustomerID, nilIfEmpty(req.SiteID), req.Name, nilIfEmpty(req.Department), nilIfEmpty(req.Notes)).Scan(&id); err != nil {
		writeErr(w, http.StatusConflict, "insert failed (name may already exist): "+err.Error())
		return
	}
	_ = writeAudit(ctx, tx, "assethub_asset_group", id, mw.UserID(ctx), "create", map[string]any{"name": req.Name})
	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit failed")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": id})
}

// UpdateGroup (staff only).
func (h *Handler) UpdateGroup(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req groupReq
	if err := decode(w, r, &req); err != nil {
		return
	}
	ctx := r.Context()
	tag, err := h.DB.Exec(ctx, `
		UPDATE assethub_asset_groups SET name=$2, site_id=$3, department=$4, notes=$5, updated_at=NOW() WHERE id=$1`,
		id, req.Name, nilIfEmpty(req.SiteID), nilIfEmpty(req.Department), nilIfEmpty(req.Notes))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "update failed")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "group not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": id})
}

// DeleteGroup (admin only). Assets are freed (group_id → NULL via FK), never
// deleted.
func (h *Handler) DeleteGroup(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ctx := r.Context()
	tag, err := h.DB.Exec(ctx, `DELETE FROM assethub_asset_groups WHERE id=$1`, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "delete failed")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "group not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
