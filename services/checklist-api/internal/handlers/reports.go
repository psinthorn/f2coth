package handlers

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/f2cothai/f2-website/services/checklist-api/internal/models"
)

// reportWindow returns the (canonical range name, from, to) for the given
// range + optional YYYY-MM-DD anchor date. Anything other than "monthly"
// falls back to a Monday-anchored ISO week. Extracted so date math is
// testable without a DB.
func reportWindow(rng, dateStr string, now time.Time) (string, time.Time, time.Time) {
	anchor := now
	if dateStr != "" {
		if t, err := time.Parse("2006-01-02", dateStr); err == nil {
			anchor = t
		}
	}
	if rng == "monthly" {
		from := time.Date(anchor.Year(), anchor.Month(), 1, 0, 0, 0, 0, anchor.Location())
		to := from.AddDate(0, 1, 0).Add(-time.Nanosecond)
		return "monthly", from, to
	}
	wd := int(anchor.Weekday())
	if wd == 0 {
		wd = 7
	}
	from := time.Date(anchor.Year(), anchor.Month(), anchor.Day()-(wd-1), 0, 0, 0, 0, anchor.Location())
	to := from.AddDate(0, 0, 7).Add(-time.Nanosecond)
	return "weekly", from, to
}

// GET /api/checklists/projects/{id}/report?range=weekly|monthly&date=YYYY-MM-DD
//
// Returns the item state-changes and visit logs in the requested date range,
// plus overall totals. The frontend renders this as the client-facing
// bilingual summary that goes into the weekly/monthly email + PDF.
func (h *Handler) GetProjectReport(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	rng := r.URL.Query().Get("range")
	if rng == "" {
		rng = "weekly"
	}
	rng, from, to := reportWindow(rng, r.URL.Query().Get("date"), time.Now())

	// Item state changes in range
	rows, err := h.DB.Query(r.Context(), `
		SELECT pi.id, pm.id, t.code, pi.text_en, pi.text_th,
		       pi.status, pi.note, pi.photo_url, pi.checked_at
		  FROM project_items pi
		  JOIN project_modules pm ON pm.id = pi.project_module_id
		  JOIN checklist_templates t ON t.id = pm.template_id
		 WHERE pm.project_id = $1
		   AND pi.checked_at IS NOT NULL
		   AND pi.checked_at >= $2
		   AND pi.checked_at <= $3
		 ORDER BY pi.checked_at DESC`, id, from, to)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	items := []models.ReportItemChange{}
	for rows.Next() {
		var it models.ReportItemChange
		var checkedAt *time.Time
		if err := rows.Scan(&it.ItemID, &it.ModuleID, &it.Code, &it.TextEN, &it.TextTH,
			&it.Status, &it.Note, &it.PhotoURL, &checkedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		if checkedAt != nil {
			it.CheckedAt = *checkedAt
		}
		items = append(items, it)
	}

	// Visits in range
	vrows, err := h.DB.Query(r.Context(), `
		SELECT id, project_id, visit_date, summary, billable, amount, created_by, created_at
		  FROM visit_logs
		 WHERE project_id = $1 AND visit_date >= $2::date AND visit_date <= $3::date
		 ORDER BY visit_date DESC`, id, from.Format("2006-01-02"), to.Format("2006-01-02"))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer vrows.Close()
	visits := []models.VisitLog{}
	for vrows.Next() {
		var v models.VisitLog
		if err := vrows.Scan(&v.ID, &v.ProjectID, &v.VisitDate, &v.Summary,
			&v.Billable, &v.Amount, &v.CreatedBy, &v.CreatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		visits = append(visits, v)
	}

	// Totals for the project (as of now, not filtered by range)
	var totals models.ProgressTotals
	err = h.DB.QueryRow(r.Context(), `
		SELECT COUNT(pi.id),
		       COUNT(*) FILTER (WHERE pi.status IN ('pass','fail','na')),
		       COUNT(*) FILTER (WHERE pi.status = 'pass'),
		       COUNT(*) FILTER (WHERE pi.status = 'fail'),
		       COUNT(*) FILTER (WHERE pi.status = 'na'),
		       COUNT(*) FILTER (WHERE pi.status = 'pending')
		  FROM project_items pi
		  JOIN project_modules pm ON pm.id = pi.project_module_id
		 WHERE pm.project_id = $1`, id).Scan(
		&totals.Total, &totals.Done, &totals.Pass, &totals.Fail, &totals.NA, &totals.Pending)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "totals error")
		return
	}

	writeJSON(w, http.StatusOK, models.Report{
		ProjectID: id, Range: rng, FromDate: from, ToDate: to,
		Items: items, Visits: visits, Totals: totals,
	})
}
