package handlers

import (
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	mw "github.com/f2cothai/f2-website/services/assethub-api/internal/middleware"
	"github.com/f2cothai/f2-website/services/assethub-api/internal/models"
)

// ListTokens (staff) lists enrollment tokens for a customer. The secret is
// never returned here — only its prefix + metadata.
func (h *Handler) ListTokens(w http.ResponseWriter, r *http.Request) {
	customerID := r.URL.Query().Get("customer_id")
	if customerID == "" {
		writeErr(w, http.StatusBadRequest, "customer_id required")
		return
	}
	rows, err := h.DB.Query(r.Context(), `
		SELECT id, customer_id, site_id, label, token_prefix, last_used_at, revoked_at, created_at
		FROM assethub_enrollment_tokens WHERE customer_id=$1 ORDER BY created_at DESC`, customerID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()
	out := []models.Token{}
	for rows.Next() {
		var t models.Token
		if err := rows.Scan(&t.ID, &t.CustomerID, &t.SiteID, &t.Label, &t.TokenPrefix,
			&t.LastUsedAt, &t.RevokedAt, &t.CreatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan failed")
			return
		}
		out = append(out, t)
	}
	writeJSON(w, http.StatusOK, out)
}

type tokenReq struct {
	CustomerID string  `json:"customer_id"`
	SiteID     *string `json:"site_id"`
	Label      string  `json:"label"`
}

// CreateToken (staff) mints a new enrollment token. The plaintext secret is
// returned exactly once in the response and only its peppered hash is stored.
func (h *Handler) CreateToken(w http.ResponseWriter, r *http.Request) {
	var req tokenReq
	if err := decode(w, r, &req); err != nil {
		return
	}
	if req.CustomerID == "" || req.Label == "" {
		writeErr(w, http.StatusBadRequest, "customer_id and label required")
		return
	}
	secret, err := randToken()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "token generation failed")
		return
	}
	hash := hashToken(h.TokenPepper, secret)
	prefix := secret[:8]

	ctx := r.Context()
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer tx.Rollback(ctx)
	var id string
	if err := tx.QueryRow(ctx, `
		INSERT INTO assethub_enrollment_tokens (customer_id, site_id, label, token_hash, token_prefix, created_by)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
		req.CustomerID, req.SiteID, req.Label, hash, prefix, nullUser(mw.UserID(ctx))).Scan(&id); err != nil {
		writeErr(w, http.StatusInternalServerError, "insert failed")
		return
	}
	_ = writeAudit(ctx, tx, "assethub_token", id, mw.UserID(ctx), "create", map[string]any{"label": req.Label})
	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit failed")
		return
	}
	writeJSON(w, http.StatusCreated, models.Token{
		ID: id, CustomerID: req.CustomerID, SiteID: req.SiteID, Label: req.Label,
		TokenPrefix: prefix, Secret: secret,
	})
}

// RevokeToken (staff) marks a token revoked; ingest lookups then reject it.
func (h *Handler) RevokeToken(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ctx := r.Context()
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `UPDATE assethub_enrollment_tokens SET revoked_at=NOW() WHERE id=$1 AND revoked_at IS NULL`, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "revoke failed")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "token not found or already revoked")
		return
	}
	_ = writeAudit(ctx, tx, "assethub_token", id, mw.UserID(ctx), "revoke", map[string]any{})
	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type tokenUpdate struct {
	Label  *string `json:"label"`
	SiteID *string `json:"site_id"`
}

// UpdateToken (staff) relabels a token and/or reassigns its site. The secret
// and hash are never touched — this is metadata only.
func (h *Handler) UpdateToken(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req tokenUpdate
	if err := decode(w, r, &req); err != nil {
		return
	}
	ctx := r.Context()
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer tx.Rollback(ctx)
	// COALESCE label (absent = leave); site_id is set directly so it can be
	// cleared to NULL by sending "".
	tag, err := tx.Exec(ctx, `
		UPDATE assethub_enrollment_tokens
		SET label = COALESCE($2, label), site_id = $3
		WHERE id=$1`, id, req.Label, normSiteID(req.SiteID))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "update failed")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "token not found")
		return
	}
	_ = writeAudit(ctx, tx, "assethub_token", id, mw.UserID(ctx), "update", map[string]any{})
	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": id})
}

// DeleteToken (admin) permanently removes a token. Prefer RevokeToken for an
// audit-preserving soft-delete; this is for cleaning up mistakes.
func (h *Handler) DeleteToken(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ctx := r.Context()
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `DELETE FROM assethub_enrollment_tokens WHERE id=$1`, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "delete failed")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "token not found")
		return
	}
	_ = writeAudit(ctx, tx, "assethub_token", id, mw.UserID(ctx), "delete", map[string]any{})
	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// normSiteID treats an empty/whitespace site_id as NULL (unassign).
func normSiteID(s *string) *string {
	if s == nil {
		return nil
	}
	if strings.TrimSpace(*s) == "" {
		return nil
	}
	return s
}

// randToken returns a URL-safe 32-byte random secret (~43 chars).
func randToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// nullUser returns nil for an empty actor id so the created_by FK stays NULL.
func nullUser(id string) *string {
	if id == "" {
		return nil
	}
	return &id
}
