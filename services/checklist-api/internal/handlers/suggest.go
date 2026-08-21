package handlers

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
)

type suggestion struct {
	NameEN string `json:"name_en"`
	NameTH string `json:"name_th"`
	Source string `json:"source"` // "library" | "project"
	Exists bool   `json:"exists"` // already present in the relevant scope (sections only)
}

// GET /api/checklists/projects/{id}/suggest?kind=section|subsection|item&q=...
//
// Powers the "smart suggestion" typeahead in the add forms so staff reuse an
// existing name instead of creating a near-duplicate. Sections pull from the
// reusable template library (+ flag ones already attached); items pull from
// the library and from items used elsewhere in the project; sub-sections pull
// from sub-sections used elsewhere in the project (no library concept).
func (h *Handler) Suggest(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")
	kind := r.URL.Query().Get("kind")
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	like := "%" + q + "%"
	ctx := r.Context()

	var sql string
	switch kind {
	case "section":
		sql = `
			SELECT t.name_en, t.name_th, 'library' AS source,
			       EXISTS(SELECT 1 FROM project_modules pm
			               WHERE pm.project_id = $1
			                 AND lower(trim(pm.name_en)) = lower(trim(t.name_en))) AS exists
			  FROM checklist_templates t
			 WHERE t.is_active AND ($2 = '' OR t.name_en ILIKE $3 OR t.name_th ILIKE $3)
			 ORDER BY t.sort_order, t.name_en
			 LIMIT 8`
	case "item":
		sql = `
			SELECT name_en, name_th, source, FALSE AS exists FROM (
			  SELECT DISTINCT ti.text_en AS name_en, ti.text_th AS name_th, 'library' AS source
			    FROM checklist_template_items ti
			   WHERE ($2 = '' OR ti.text_en ILIKE $3 OR ti.text_th ILIKE $3)
			  UNION
			  SELECT DISTINCT pi.text_en, pi.text_th, 'project' AS source
			    FROM project_items pi
			    JOIN project_modules pm ON pm.id = pi.project_module_id
			   WHERE pm.project_id = $1 AND ($2 = '' OR pi.text_en ILIKE $3 OR pi.text_th ILIKE $3)
			) s
			ORDER BY name_en
			LIMIT 10`
	case "subsection":
		sql = `
			SELECT DISTINCT ps.name_en, ps.name_th, 'project' AS source, FALSE AS exists
			  FROM project_subsections ps
			  JOIN project_modules pm ON pm.id = ps.project_module_id
			 WHERE pm.project_id = $1 AND ($2 = '' OR ps.name_en ILIKE $3 OR ps.name_th ILIKE $3)
			 ORDER BY ps.name_en
			 LIMIT 8`
	default:
		writeErr(w, http.StatusBadRequest, "kind must be section, subsection or item")
		return
	}

	rows, err := h.DB.Query(ctx, sql, projectID, q, like)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error: "+err.Error())
		return
	}
	defer rows.Close()
	out := []suggestion{}
	for rows.Next() {
		var s suggestion
		if err := rows.Scan(&s.NameEN, &s.NameTH, &s.Source, &s.Exists); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, s)
	}
	writeJSON(w, http.StatusOK, map[string]any{"suggestions": out})
}
