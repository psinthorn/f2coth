package handlers

import (
	"context"
	"encoding/json"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	mw "github.com/f2cothai/f2-website/services/contract-api/internal/middleware"
	"github.com/f2cothai/f2-website/services/contract-api/internal/models"
)

// Allowed MIME types for a signed-scan upload (photo of the signed pages, or a
// scanned PDF). Generated docx/pdf are produced internally, not uploaded.
var allowedSignedMIME = map[string]string{
	"application/pdf": ".pdf",
	"image/jpeg":      ".jpg",
	"image/png":       ".png",
}

// POST /api/contracts/{id}/files (staff) — multipart signed-scan upload. On
// success the contract advances to `signed` (from draft/sent/signed). Works
// from a phone browser (same mechanism as the checklist photo upload).
func (h *Handler) UploadFile(w http.ResponseWriter, r *http.Request) {
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

	r.Body = http.MaxBytesReader(w, r.Body, maxContractFileBytes)
	if err := r.ParseMultipartForm(maxContractFileBytes); err != nil {
		writeErr(w, http.StatusBadRequest, "file too large or malformed multipart")
		return
	}
	file, hdr, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "missing file field")
		return
	}
	defer file.Close()

	mime := hdr.Header.Get("Content-Type")
	ext, ok := allowedSignedMIME[mime]
	if !ok {
		writeErr(w, http.StatusBadRequest, "unsupported type (pdf/jpg/png only): "+mime)
		return
	}
	payload, err := io.ReadAll(file)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "read failed")
		return
	}

	path, sum, err := h.saveBytes(payload, ext)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "store failed: "+err.Error())
		return
	}

	userID := mw.UserID(r.Context())
	filename := hdr.Filename
	if filename == "" {
		filename = "signed" + ext
	}

	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "tx error")
		return
	}
	defer tx.Rollback(r.Context())

	var fileID string
	if err := tx.QueryRow(r.Context(), `
		INSERT INTO contract_files
			(contract_id, kind, filename, storage_path, mime_type, size_bytes, sha256, uploaded_by)
		VALUES ($1,'signed_scan',$2,$3,$4,$5,$6, NULLIF($7,'')::uuid) RETURNING id`,
		id, filename, path, mime, len(payload), sum, userID).Scan(&fileID); err != nil {
		writeErr(w, http.StatusInternalServerError, "db error: "+err.Error())
		return
	}

	// Uploading a signed scan advances to `signed` when that's a legal move.
	newStatus := status
	if CanTransition(status, "signed") {
		if _, err := tx.Exec(r.Context(), `UPDATE contracts SET status = 'signed' WHERE id = $1`, id); err != nil {
			writeErr(w, http.StatusInternalServerError, "db error: "+err.Error())
			return
		}
		_ = recordStatusEvent(r.Context(), tx, id, status, "signed", "signed scan uploaded", userID)
		newStatus = "signed"
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit error: "+err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": fileID, "status": newStatus})
}

// GET /api/contracts/{id}/files/{fileId} (staff) — stream a stored file.
func (h *Handler) DownloadFile(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	fileID := chi.URLParam(r, "fileId")

	var filename, storagePath, mime string
	err := h.DB.QueryRow(r.Context(), `
		SELECT filename, storage_path, mime_type
		  FROM contract_files WHERE id = $1 AND contract_id = $2`, fileID, id).
		Scan(&filename, &storagePath, &mime)
	if err == pgx.ErrNoRows {
		writeErr(w, http.StatusNotFound, "file not found")
		return
	} else if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}

	f, err := h.openStored(storagePath)
	if err != nil {
		writeErr(w, http.StatusNotFound, "file missing on disk")
		return
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "stat failed")
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Disposition", `inline; filename="`+filename+`"`)
	http.ServeContent(w, r, filename, stat.ModTime(), f)
}

// listFiles returns a contract's files (metadata only), newest first.
func (h *Handler) listFiles(ctx context.Context, contractID string) ([]models.File, error) {
	rows, err := h.DB.Query(ctx, `
		SELECT id, contract_id, kind, filename, storage_path, mime_type, size_bytes,
		       sha256, uploaded_by, created_at
		  FROM contract_files WHERE contract_id = $1 ORDER BY created_at DESC`, contractID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.File{}
	for rows.Next() {
		var f models.File
		if err := rows.Scan(&f.ID, &f.ContractID, &f.Kind, &f.Filename, &f.StoragePath,
			&f.MimeType, &f.SizeBytes, &f.SHA256, &f.UploadedBy, &f.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, nil
}

// queueIACCDraft inserts an invoice-draft payload into iacc_outbox on
// activation. A future worker drains it to iACC via internal/iacc. company_id
// comes from the linked project's iacc_company_id when present.
func (h *Handler) queueIACCDraft(ctx context.Context, tx pgx.Tx, contractID, docNo string, feeTotal *float64, projectID *string) error {
	var companyID *string
	if projectID != nil {
		_ = tx.QueryRow(ctx, `SELECT iacc_company_id FROM projects WHERE id = $1`, *projectID).Scan(&companyID)
	}
	payload := map[string]any{
		"doc_no":     docNo,
		"fee_total":  feeTotal,
		"currency":   "THB",
		"company_id": companyID,
	}
	raw, _ := json.Marshal(payload)
	_, err := tx.Exec(ctx, `
		INSERT INTO iacc_outbox (contract_id, payload) VALUES ($1, $2)`, contractID, raw)
	return err
}
