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

	"github.com/f2cothai/f2-website/services/auth-api/internal/config"
	authmw "github.com/f2cothai/f2-website/services/auth-api/internal/middleware"
	"github.com/f2cothai/f2-website/services/auth-api/internal/models"
)

type UserHandler struct {
	DB  *pgxpool.Pool
	Cfg config.Config
}

var validRoles = map[string]struct{}{"admin": {}, "editor": {}, "viewer": {}}

func (h *UserHandler) List(w http.ResponseWriter, r *http.Request) {
	rows, err := h.DB.Query(r.Context(), `
        SELECT id, email, password_hash, full_name, role, locale, is_active,
               last_login_at, created_at, updated_at
        FROM users
        ORDER BY (disabled_at IS NULL) DESC, created_at DESC
    `)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()

	out := make([]models.User, 0, 16)
	for rows.Next() {
		var u models.User
		if err := rows.Scan(&u.ID, &u.Email, &u.PasswordHash, &u.FullName, &u.Role, &u.Locale,
			&u.IsActive, &u.LastLoginAt, &u.CreatedAt, &u.UpdatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, u)
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": out})
}

type createUserReq struct {
	Email    string `json:"email"`
	FullName string `json:"full_name"`
	Role     string `json:"role"`
	Password string `json:"password"`
}

func (h *UserHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req createUserReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.FullName = strings.TrimSpace(req.FullName)
	req.Role = strings.TrimSpace(req.Role)
	if req.Email == "" || req.FullName == "" || req.Password == "" {
		writeErr(w, http.StatusBadRequest, "email, full_name, password required")
		return
	}
	if _, ok := validRoles[req.Role]; !ok {
		writeErr(w, http.StatusBadRequest, "role must be admin, editor, or viewer")
		return
	}
	if len(req.Password) < 12 {
		writeErr(w, http.StatusBadRequest, "password must be at least 12 characters")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), h.Cfg.BcryptCost)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "hash error")
		return
	}

	var u models.User
	err = h.DB.QueryRow(r.Context(), `
        INSERT INTO users (email, password_hash, full_name, role)
        VALUES ($1, $2, $3, $4)
        RETURNING id, email, password_hash, full_name, role, locale, is_active,
                  last_login_at, created_at, updated_at
    `, req.Email, string(hash), req.FullName, req.Role).
		Scan(&u.ID, &u.Email, &u.PasswordHash, &u.FullName, &u.Role, &u.Locale,
			&u.IsActive, &u.LastLoginAt, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		// unique violation on email
		if strings.Contains(err.Error(), "users_email_key") {
			writeErr(w, http.StatusConflict, "a user with this email already exists")
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not create user")
		return
	}
	writeJSON(w, http.StatusCreated, u)
}

type updateUserReq struct {
	FullName *string `json:"full_name"`
	Role     *string `json:"role"`
}

func (h *UserHandler) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	actorID, _ := r.Context().Value(authmw.CtxUserID).(string)

	var req updateUserReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}

	// Self-protection: cannot change your own role.
	if req.Role != nil && id == actorID {
		writeErr(w, http.StatusBadRequest, "cannot change your own role")
		return
	}
	if req.Role != nil {
		if _, ok := validRoles[*req.Role]; !ok {
			writeErr(w, http.StatusBadRequest, "invalid role")
			return
		}
	}

	// Build SET clause dynamically (small surface, safe).
	tag, err := h.DB.Exec(r.Context(), `
        UPDATE users SET
            full_name = COALESCE($2, full_name),
            role      = COALESCE($3, role)
        WHERE id = $1
    `, id, req.FullName, req.Role)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "user not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *UserHandler) Disable(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	actorID, _ := r.Context().Value(authmw.CtxUserID).(string)

	if id == actorID {
		writeErr(w, http.StatusBadRequest, "cannot disable your own account")
		return
	}

	tag, err := h.DB.Exec(r.Context(), `
        UPDATE users SET disabled_at = NOW(), is_active = FALSE
        WHERE id = $1 AND disabled_at IS NULL
    `, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "user not found or already disabled")
		return
	}
	// Revoke all of their active refresh tokens immediately.
	_, _ = h.DB.Exec(r.Context(),
		`UPDATE refresh_tokens SET revoked_at = NOW()
         WHERE user_id = $1 AND revoked_at IS NULL`, id)
	w.WriteHeader(http.StatusNoContent)
}

func (h *UserHandler) Enable(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	tag, err := h.DB.Exec(r.Context(), `
        UPDATE users SET disabled_at = NULL, is_active = TRUE
        WHERE id = $1
    `, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "user not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// suppress unused import vars in some build configs
var _ = errors.New
var _ = pgx.ErrNoRows
