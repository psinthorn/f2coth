package handlers

// Attachments — documents, images, and geo-tagged live photos on projects,
// project items, and visit logs. BYTEA storage with an auth-gated serve
// endpoint, modelled on payment-api's slip files. This is the on-site
// use case: a tech takes a live photo with the device camera and it's
// stamped with GPS coordinates captured client-side.
//
// Staff write + read anything; customer portal reads are scoped to the
// caller's own projects and only when visible_to_customer is set.
//
// owner_type/owner_id is a soft polymorphic reference into the shared
// attachments table (migration 053). customer-api owns ticket* rows with
// an identical handler; keep the MIME allowlist + size cap in sync.

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	mw "github.com/f2cothai/f2-website/services/checklist-api/internal/middleware"
)

const maxAttachmentBytes = 10 * 1024 * 1024 // 10 MiB — matches migration 053 CHECK.

// allowedAttachmentMIME — images plus common document formats. Keep in
// sync with the customer-api copy.
var allowedAttachmentMIME = map[string]bool{
	"image/jpeg":         true,
	"image/png":          true,
	"image/webp":         true,
	"image/gif":          true,
	"image/heic":         true,
	"image/heif":         true,
	"application/pdf":    true,
	"application/msword": true,
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document": true,
	"application/vnd.ms-excel": true,
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": true,
	"text/plain": true,
	"text/csv":   true,
}

var validAttachmentKind = map[string]bool{"document": true, "image": true, "live_photo": true}

// checklistOwnerTypes — owner kinds this service accepts.
var checklistOwnerTypes = map[string]bool{"project": true, "project_item": true, "visit_log": true}

type attachmentMeta struct {
	ID         string     `json:"id"`
	Kind       string     `json:"kind"`
	Filename   string     `json:"filename"`
	MimeType   string     `json:"mime_type"`
	SizeBytes  int        `json:"size_bytes"`
	Latitude   *float64   `json:"latitude,omitempty"`
	Longitude  *float64   `json:"longitude,omitempty"`
	AccuracyM  *float64   `json:"accuracy_m,omitempty"`
	CapturedAt *time.Time `json:"captured_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
}

// attachmentOwner resolves the customer that owns an attachment owner (may
// be NULL for internal engagements) and whether it's visible to that
// customer. Returns pgx.ErrNoRows if the owner row doesn't exist.
func (h *Handler) attachmentOwner(ctx context.Context, ownerType, ownerID string) (customerID *string, visible bool, err error) {
	switch ownerType {
	case "project":
		err = h.DB.QueryRow(ctx,
			`SELECT customer_id::text, visible_to_customer FROM projects WHERE id=$1`, ownerID).
			Scan(&customerID, &visible)
	case "project_item":
		err = h.DB.QueryRow(ctx, `
			SELECT p.customer_id::text, p.visible_to_customer
			  FROM project_items pi
			  JOIN project_modules pm ON pm.id = pi.project_module_id
			  JOIN projects p ON p.id = pm.project_id
			 WHERE pi.id=$1`, ownerID).
			Scan(&customerID, &visible)
	case "visit_log":
		err = h.DB.QueryRow(ctx, `
			SELECT p.customer_id::text, p.visible_to_customer
			  FROM visit_logs vl
			  JOIN projects p ON p.id = vl.project_id
			 WHERE vl.id=$1`, ownerID).
			Scan(&customerID, &visible)
	default:
		err = pgx.ErrNoRows
	}
	return
}

// customerCanSee reports whether the portal caller may read the owner.
func customerCanSee(customerID *string, visible bool, callerCustomer string) bool {
	return visible && customerID != nil && *customerID == callerCustomer && callerCustomer != ""
}

// CreateAttachment — staff-only. POST multipart/form-data: file +
// owner_type + owner_id + kind (+ optional latitude/longitude/accuracy/
// captured_at for live photos).
func (h *Handler) CreateAttachment(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxAttachmentBytes+1024)
	if err := r.ParseMultipartForm(maxAttachmentBytes + 1024); err != nil {
		writeErr(w, http.StatusBadRequest, "file too large or malformed multipart")
		return
	}

	ownerType := r.FormValue("owner_type")
	ownerID := r.FormValue("owner_id")
	kind := r.FormValue("kind")
	if kind == "" {
		kind = "document"
	}
	if ownerID == "" {
		writeErr(w, http.StatusBadRequest, "owner_id required")
		return
	}
	if !checklistOwnerTypes[ownerType] {
		writeErr(w, http.StatusBadRequest, "unsupported owner_type for this service")
		return
	}
	if !validAttachmentKind[kind] {
		writeErr(w, http.StatusBadRequest, "invalid kind")
		return
	}

	// Verify the owner exists before storing bytes.
	if _, _, err := h.attachmentOwner(r.Context(), ownerType, ownerID); err == pgx.ErrNoRows {
		writeErr(w, http.StatusNotFound, "owner not found")
		return
	} else if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "file field missing")
		return
	}
	defer file.Close()

	if header.Size <= 0 || header.Size > maxAttachmentBytes {
		writeErr(w, http.StatusRequestEntityTooLarge, "file must be 1 byte to 10 MB")
		return
	}
	mime := header.Header.Get("Content-Type")
	if !allowedAttachmentMIME[mime] {
		writeErr(w, http.StatusUnsupportedMediaType, "unsupported media type: "+mime)
		return
	}

	buf, err := io.ReadAll(io.LimitReader(file, maxAttachmentBytes))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not read upload")
		return
	}
	if len(buf) == 0 {
		writeErr(w, http.StatusBadRequest, "empty file")
		return
	}
	sum := sha256.Sum256(buf)
	digest := hex.EncodeToString(sum[:])

	lat, lng, acc, capturedAt := parseGeo(r)

	uid := mw.UserID(r.Context())
	if uid == "" {
		writeErr(w, http.StatusForbidden, "no uploader identity")
		return
	}

	var id string
	if err := h.DB.QueryRow(r.Context(), `
		INSERT INTO attachments (
			owner_type, owner_id, kind, filename, mime_type, size_bytes, sha256, content,
			latitude, longitude, accuracy_m, captured_at, uploaded_by_user_id
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		RETURNING id`,
		ownerType, ownerID, kind, header.Filename, mime, len(buf), digest, buf,
		lat, lng, acc, capturedAt, uid).Scan(&id); err != nil {
		writeErr(w, http.StatusInternalServerError, "store attachment: "+err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"id":         id,
		"kind":       kind,
		"filename":   header.Filename,
		"mime_type":  mime,
		"size_bytes": len(buf),
	})
}

// ListAttachments — staff read, metadata only.
func (h *Handler) ListAttachments(w http.ResponseWriter, r *http.Request) {
	ownerType := r.URL.Query().Get("owner_type")
	ownerID := r.URL.Query().Get("owner_id")
	if ownerID == "" || !checklistOwnerTypes[ownerType] {
		writeErr(w, http.StatusBadRequest, "owner_type and owner_id required")
		return
	}
	h.listAttachments(w, r, ownerType, ownerID)
}

// PortalListAttachments — customer read, scoped to their visible projects.
func (h *Handler) PortalListAttachments(w http.ResponseWriter, r *http.Request) {
	ownerType := r.URL.Query().Get("owner_type")
	ownerID := r.URL.Query().Get("owner_id")
	if ownerID == "" || !checklistOwnerTypes[ownerType] {
		writeErr(w, http.StatusBadRequest, "owner_type and owner_id required")
		return
	}
	cust, visible, err := h.attachmentOwner(r.Context(), ownerType, ownerID)
	if err != nil || !customerCanSee(cust, visible, mw.CustomerID(r.Context())) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	h.listAttachments(w, r, ownerType, ownerID)
}

func (h *Handler) listAttachments(w http.ResponseWriter, r *http.Request, ownerType, ownerID string) {
	rows, err := h.DB.Query(r.Context(), `
		SELECT id, kind, filename, mime_type, size_bytes,
		       latitude, longitude, accuracy_m, captured_at, created_at
		  FROM attachments
		 WHERE owner_type=$1 AND owner_id=$2
		 ORDER BY created_at ASC`, ownerType, ownerID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()

	out := make([]attachmentMeta, 0, 8)
	for rows.Next() {
		var m attachmentMeta
		if err := rows.Scan(&m.ID, &m.Kind, &m.Filename, &m.MimeType, &m.SizeBytes,
			&m.Latitude, &m.Longitude, &m.AccuracyM, &m.CapturedAt, &m.CreatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, m)
	}
	writeJSON(w, http.StatusOK, map[string]any{"attachments": out})
}

// ServeAttachment — staff read, streams the file.
func (h *Handler) ServeAttachment(w http.ResponseWriter, r *http.Request) {
	h.serveAttachment(w, r, false)
}

// PortalServeAttachment — customer read, scoped to their visible projects.
func (h *Handler) PortalServeAttachment(w http.ResponseWriter, r *http.Request) {
	h.serveAttachment(w, r, true)
}

func (h *Handler) serveAttachment(w http.ResponseWriter, r *http.Request, portal bool) {
	id := chi.URLParam(r, "id")

	var (
		ownerType, ownerID string
		filename, mime     string
		content            []byte
		size               int
	)
	if err := h.DB.QueryRow(r.Context(), `
		SELECT owner_type, owner_id::text, filename, mime_type, size_bytes, content
		  FROM attachments WHERE id=$1`, id).
		Scan(&ownerType, &ownerID, &filename, &mime, &size, &content); err != nil {
		writeErr(w, http.StatusNotFound, "attachment not found")
		return
	}

	if portal {
		cust, visible, err := h.attachmentOwner(r.Context(), ownerType, ownerID)
		if err != nil || !customerCanSee(cust, visible, mw.CustomerID(r.Context())) {
			writeErr(w, http.StatusNotFound, "not found")
			return
		}
	}

	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Length", strconv.Itoa(size))
	w.Header().Set("Content-Disposition", "inline; filename=\""+filename+"\"")
	w.Header().Set("Cache-Control", "private, max-age=300")
	_, _ = w.Write(content)
}

// DeleteAttachment — staff-only.
func (h *Handler) DeleteAttachment(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	tag, err := h.DB.Exec(r.Context(), `DELETE FROM attachments WHERE id=$1`, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "delete failed")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "attachment not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// parseGeo pulls optional geolocation fields from the multipart form.
// Enforces the table's (latitude NULL) = (longitude NULL) invariant.
func parseGeo(r *http.Request) (lat, lng, acc *float64, capturedAt *time.Time) {
	if f, ok := parseFloatField(r, "latitude"); ok {
		lat = &f
	}
	if f, ok := parseFloatField(r, "longitude"); ok {
		lng = &f
	}
	if f, ok := parseFloatField(r, "accuracy"); ok {
		acc = &f
	}
	if v := r.FormValue("captured_at"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			capturedAt = &t
		}
	}
	if lat == nil || lng == nil {
		lat, lng = nil, nil
	}
	return
}

func parseFloatField(r *http.Request, name string) (float64, bool) {
	v := r.FormValue(name)
	if v == "" {
		return 0, false
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return 0, false
	}
	return f, true
}
