package handlers

import (
	"net/http"
	"os"
	"path/filepath"

	"github.com/go-chi/chi/v5"

	mw "github.com/f2cothai/f2-website/services/assethub-api/internal/middleware"
	"github.com/f2cothai/f2-website/services/assethub-api/internal/models"
)

type reportReq struct {
	CustomerID string  `json:"customer_id"`
	SiteID     *string `json:"site_id"`
	ProjectID  *string `json:"project_id"`
	Format     string  `json:"format"`
}

// CreateReport (staff) enqueues a handover-document job. The worker renders
// it asynchronously (xlsx via excelize, pdf/docx via docgen) and flips status
// to 'done' with a file_path the download route streams.
func (h *Handler) CreateReport(w http.ResponseWriter, r *http.Request) {
	var req reportReq
	if err := decode(w, r, &req); err != nil {
		return
	}
	if req.CustomerID == "" {
		writeErr(w, http.StatusBadRequest, "customer_id required")
		return
	}
	format := req.Format
	switch format {
	case "xlsx", "pdf", "docx":
	default:
		format = "xlsx"
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
		INSERT INTO assethub_report_jobs (customer_id, site_id, project_id, format, requested_by)
		VALUES ($1,$2,$3,$4,$5) RETURNING id`,
		req.CustomerID, req.SiteID, req.ProjectID, format, nullUser(mw.UserID(ctx))).Scan(&id); err != nil {
		writeErr(w, http.StatusInternalServerError, "enqueue failed")
		return
	}
	_ = writeAudit(ctx, tx, "assethub_report", id, mw.UserID(ctx), "enqueue", map[string]any{"format": format})
	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit failed")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": id, "status": "queued"})
}

// ListReports (staff) lists recent report jobs for a customer.
func (h *Handler) ListReports(w http.ResponseWriter, r *http.Request) {
	customerID := r.URL.Query().Get("customer_id")
	if customerID == "" {
		writeErr(w, http.StatusBadRequest, "customer_id required")
		return
	}
	rows, err := h.DB.Query(r.Context(), `
		SELECT id, customer_id, site_id, format, status, attempts, file_path, error, created_at, updated_at
		FROM assethub_report_jobs WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 100`, customerID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()
	out := []models.ReportJob{}
	for rows.Next() {
		var j models.ReportJob
		if err := rows.Scan(&j.ID, &j.CustomerID, &j.SiteID, &j.Format, &j.Status, &j.Attempts,
			&j.FilePath, &j.Error, &j.CreatedAt, &j.UpdatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan failed")
			return
		}
		out = append(out, j)
	}
	writeJSON(w, http.StatusOK, out)
}

// DownloadReport (staff) streams a finished report file from the reports volume.
func (h *Handler) DownloadReport(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var status, format string
	var filePath *string
	err := h.DB.QueryRow(r.Context(), `SELECT status, format, file_path FROM assethub_report_jobs WHERE id=$1`, id).
		Scan(&status, &format, &filePath)
	if err != nil {
		writeErr(w, http.StatusNotFound, "report not found")
		return
	}
	if status != "done" || filePath == nil {
		writeErr(w, http.StatusConflict, "report not ready (status: "+status+")")
		return
	}
	// Prevent path traversal: only serve files inside the reports dir.
	clean := filepath.Clean(*filePath)
	if !isInside(h.ReportsDir, clean) {
		writeErr(w, http.StatusForbidden, "invalid report path")
		return
	}
	f, err := os.Open(clean)
	if err != nil {
		writeErr(w, http.StatusNotFound, "report file missing")
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", contentType(format))
	w.Header().Set("Content-Disposition", "attachment; filename=handover."+format)
	http.ServeContent(w, r, filepath.Base(clean), zeroTime(), f)
}

func contentType(format string) string {
	switch format {
	case "xlsx":
		return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	case "docx":
		return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	case "pdf":
		return "application/pdf"
	default:
		return "application/octet-stream"
	}
}
