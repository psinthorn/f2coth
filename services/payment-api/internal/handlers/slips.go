package handlers

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/f2cothai/f2-website/services/payment-api/internal/config"
)

// SlipHandler handles transfer-slip files. Real upload (multipart) +
// auth-gated download — replaces the old "paste a public URL" UX.
type SlipHandler struct {
	DB  *pgxpool.Pool
	Cfg config.Config
}

const (
	maxSlipBytes = 5 * 1024 * 1024 // 5 MB
)

var allowedSlipMIME = map[string]bool{
	"image/jpeg":      true,
	"image/png":       true,
	"image/webp":      true,
	"image/gif":       true,
	"application/pdf": true,
}

// PortalUpload accepts a multipart "file" field from the portal pay
// flow, stores it inline, and stamps the parent payment's slip_url to
// /api/payment/slips/{file_id} so the existing render path keeps
// working unchanged.
func (h *SlipHandler) PortalUpload(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	if cid == "" {
		writeErr(w, 403, "no customer context")
		return
	}
	paymentID := chi.URLParam(r, "payID")

	if err := r.ParseMultipartForm(maxSlipBytes + 1024); err != nil {
		writeErr(w, 400, "could not parse upload")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeErr(w, 400, "file field missing")
		return
	}
	defer file.Close()

	if header.Size <= 0 || header.Size > maxSlipBytes {
		writeErr(w, 413, "file must be 1 byte to 5 MB")
		return
	}
	mime := header.Header.Get("Content-Type")
	if !allowedSlipMIME[mime] {
		writeErr(w, 415, "unsupported media type — accept jpeg/png/webp/gif/pdf")
		return
	}

	buf := make([]byte, 0, header.Size)
	limited := io.LimitReader(file, maxSlipBytes)
	read, err := io.ReadAll(limited)
	if err != nil {
		writeErr(w, 500, "could not read upload")
		return
	}
	buf = append(buf, read...)
	if len(buf) == 0 {
		writeErr(w, 400, "empty file")
		return
	}

	sum := sha256.Sum256(buf)
	digest := hex.EncodeToString(sum[:])

	ctx, cancel := makeCtx()
	defer cancel()

	tx, err := h.DB.Begin(ctx)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer tx.Rollback(ctx)

	// Verify the payment belongs to the customer + is in an uploadable
	// state (mirrors PaymentHandler.PortalUploadSlip's WHERE clause).
	var method, status string
	if err := tx.QueryRow(ctx, `
		SELECT method, status FROM payments
		 WHERE id=$1 AND customer_id=$2 FOR UPDATE`,
		paymentID, cid).Scan(&method, &status); err != nil {
		writeErr(w, 404, "payment not found")
		return
	}
	if method == "paypal" {
		writeErr(w, 409, "slip upload not applicable to paypal payments")
		return
	}
	if status != "pending" && status != "awaiting_verification" {
		writeErr(w, 409, "payment is not in an uploadable state")
		return
	}

	var fileID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO payment_slip_files (
			payment_id, customer_id, filename, mime_type, size_bytes, sha256, content
		) VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id`,
		paymentID, cid, header.Filename, mime, len(buf), digest, buf).
		Scan(&fileID); err != nil {
		writeErr(w, 500, "store slip: "+err.Error())
		return
	}

	url := "/api/payment/slips/" + fileID
	if _, err := tx.Exec(ctx, `
		UPDATE payments
		   SET slip_url=$1, slip_uploaded_at=NOW(),
		       status='awaiting_verification'
		 WHERE id=$2`, url, paymentID); err != nil {
		writeErr(w, 500, err.Error())
		return
	}

	if err := tx.Commit(ctx); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 201, map[string]any{
		"file_id":    fileID,
		"slip_url":   url,
		"size_bytes": len(buf),
		"mime_type":  mime,
		"status":     "awaiting_verification",
	})
}

// Serve streams a stored slip to the caller. Auth: the owning customer
// (portal token) or any staff (admin token). chi resolves the {fileID}
// param; the handler is mounted twice — once under /portal (customer
// audience) and once under /admin (staff audience) — to keep the
// audience middleware aligned with the rest of the routes.
func (h *SlipHandler) Serve(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "fileID")

	ctx, cancel := makeCtx()
	defer cancel()

	var (
		ownerCustomer  string
		filename, mime string
		content        []byte
		size           int
	)
	if err := h.DB.QueryRow(ctx, `
		SELECT customer_id::text, filename, mime_type, size_bytes, content
		  FROM payment_slip_files WHERE id=$1`, id).
		Scan(&ownerCustomer, &filename, &mime, &size, &content); err != nil {
		writeErr(w, 404, "slip not found")
		return
	}

	// Auth scope check — staff (customerID empty) sees everything;
	// customers see only their own.
	cid := customerID(r)
	if cid != "" && cid != ownerCustomer {
		writeErr(w, 403, "not your slip")
		return
	}

	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Length", fmt.Sprintf("%d", size))
	w.Header().Set("Content-Disposition", "inline; filename=\""+filename+"\"")
	w.Header().Set("Cache-Control", "private, max-age=300")
	_, _ = w.Write(content)
}
