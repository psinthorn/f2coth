package handlers

// Attachments — documents, images, and geo-tagged live photos on tickets
// and ticket messages. BYTEA storage with an auth-gated serve endpoint,
// modelled on payment-api's slip files (services/payment-api/internal/
// handlers/slips.go). Multi-file uploads are done by the client looping
// single-file POSTs, so this handler stays one-file-per-request.
//
// owner_type/owner_id is a soft polymorphic reference into the attachments
// table (migration 053). This service only manages ticket + ticket_message
// owners; checklist-api owns project* rows with an identical handler.
//
// Keep maxAttachmentBytes and allowedAttachmentMIME in sync with the
// checklist-api copy and the size CHECK in migration 053.

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/f2cothai/f2-website/services/customer-api/internal/config"
)

type AttachmentHandler struct {
	DB  *pgxpool.Pool
	Cfg config.Config
}

const maxAttachmentBytes = 10 * 1024 * 1024 // 10 MiB — matches migration 053 CHECK.

// allowedAttachmentMIME — images plus common document formats.
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

// customerOwnerTypes — owner kinds this service accepts.
var customerOwnerTypes = map[string]bool{"ticket": true, "ticket_message": true}

var errUnsupportedOwner = errors.New("unsupported owner type")

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

// ownerCustomer resolves the customer that owns an attachment owner, plus
// (for ticket_message) whether the message is staff-internal. Returns
// pgx.ErrNoRows if the owner row doesn't exist.
func (h *AttachmentHandler) ownerCustomer(ctx context.Context, ownerType, ownerID string) (customerID string, internal bool, err error) {
	switch ownerType {
	case "ticket":
		err = h.DB.QueryRow(ctx,
			`SELECT customer_id::text, FALSE FROM tickets WHERE id=$1`, ownerID).
			Scan(&customerID, &internal)
	case "ticket_message":
		err = h.DB.QueryRow(ctx, `
			SELECT t.customer_id::text, m.internal
			  FROM ticket_messages m
			  JOIN tickets t ON t.id = m.ticket_id
			 WHERE m.id=$1`, ownerID).
			Scan(&customerID, &internal)
	default:
		err = errUnsupportedOwner
	}
	return
}

// authorizeOwner verifies the caller may access attachments on this owner.
// Returns (0, "") on success, else an HTTP status + message. Staff callers
// (empty customerID) pass ownership; customers must own the ticket and are
// never shown attachments on internal staff messages.
func (h *AttachmentHandler) authorizeOwner(r *http.Request, ownerType, ownerID string) (int, string) {
	if !customerOwnerTypes[ownerType] {
		return http.StatusBadRequest, "unsupported owner_type for this service"
	}
	ownerCust, internal, err := h.ownerCustomer(r.Context(), ownerType, ownerID)
	if err == pgx.ErrNoRows {
		return http.StatusNotFound, "owner not found"
	}
	if err != nil {
		return http.StatusInternalServerError, "db error"
	}
	if cid := customerID(r); cid != "" {
		if cid != ownerCust || internal {
			// Hide internal messages behind a 404 rather than 403 so we don't
			// leak that they exist.
			if cid != ownerCust {
				return http.StatusForbidden, "not your resource"
			}
			return http.StatusNotFound, "owner not found"
		}
	}
	return 0, ""
}

// Upload — POST multipart/form-data: file + owner_type + owner_id + kind
// (+ optional latitude/longitude/accuracy/captured_at for live photos).
func (h *AttachmentHandler) Upload(w http.ResponseWriter, r *http.Request) {
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
	if !validAttachmentKind[kind] {
		writeErr(w, http.StatusBadRequest, "invalid kind")
		return
	}
	if status, msg := h.authorizeOwner(r, ownerType, ownerID); status != 0 {
		writeErr(w, status, msg)
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

	// Exactly one uploader identity per the table CHECK.
	var uploaderUser, uploaderContact *string
	if uid := staffID(r); uid != "" {
		uploaderUser = &uid
	} else if cc := contactID(r); cc != "" {
		uploaderContact = &cc
	} else {
		writeErr(w, http.StatusForbidden, "no uploader identity")
		return
	}

	ctx, cancel := makeCtx()
	defer cancel()

	var id string
	if err := h.DB.QueryRow(ctx, `
		INSERT INTO attachments (
			owner_type, owner_id, kind, filename, mime_type, size_bytes, sha256, content,
			latitude, longitude, accuracy_m, captured_at,
			uploaded_by_user_id, uploaded_by_contact_id
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
		RETURNING id`,
		ownerType, ownerID, kind, header.Filename, mime, len(buf), digest, buf,
		lat, lng, acc, capturedAt, uploaderUser, uploaderContact).Scan(&id); err != nil {
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

// List — GET ?owner_type=&owner_id= — metadata only (never content).
func (h *AttachmentHandler) List(w http.ResponseWriter, r *http.Request) {
	ownerType := r.URL.Query().Get("owner_type")
	ownerID := r.URL.Query().Get("owner_id")
	if ownerID == "" {
		writeErr(w, http.StatusBadRequest, "owner_id required")
		return
	}
	if status, msg := h.authorizeOwner(r, ownerType, ownerID); status != 0 {
		writeErr(w, status, msg)
		return
	}

	ctx, cancel := makeCtx()
	defer cancel()
	rows, err := h.DB.Query(ctx, `
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

// Serve — GET /attachments/{id} — streams the file, auth-gated by owner.
func (h *AttachmentHandler) Serve(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	ctx, cancel := makeCtx()
	defer cancel()
	var (
		ownerType, ownerID string
		filename, mime     string
		content            []byte
		size               int
	)
	if err := h.DB.QueryRow(ctx, `
		SELECT owner_type, owner_id::text, filename, mime_type, size_bytes, content
		  FROM attachments WHERE id=$1`, id).
		Scan(&ownerType, &ownerID, &filename, &mime, &size, &content); err != nil {
		writeErr(w, http.StatusNotFound, "attachment not found")
		return
	}
	if status, msg := h.authorizeOwner(r, ownerType, ownerID); status != 0 {
		writeErr(w, status, msg)
		return
	}

	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Length", strconv.Itoa(size))
	w.Header().Set("Content-Disposition", "inline; filename=\""+filename+"\"")
	w.Header().Set("Cache-Control", "private, max-age=300")
	_, _ = w.Write(content)
}

// Delete — DELETE /attachments/{id}, auth-gated by owner.
func (h *AttachmentHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	ctx, cancel := makeCtx()
	defer cancel()
	var ownerType, ownerID string
	if err := h.DB.QueryRow(ctx,
		`SELECT owner_type, owner_id::text FROM attachments WHERE id=$1`, id).
		Scan(&ownerType, &ownerID); err != nil {
		writeErr(w, http.StatusNotFound, "attachment not found")
		return
	}
	if status, msg := h.authorizeOwner(r, ownerType, ownerID); status != 0 {
		writeErr(w, status, msg)
		return
	}
	if _, err := h.DB.Exec(ctx, `DELETE FROM attachments WHERE id=$1`, id); err != nil {
		writeErr(w, http.StatusInternalServerError, "delete failed")
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
