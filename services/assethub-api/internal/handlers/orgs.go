package handlers

import (
	"net/http"
)

// org is a thin projection of a customers row for the AssetHub org switcher.
type org struct {
	ID        string `json:"id"`
	Slug      string `json:"slug"`
	Name      string `json:"name"`
	Devices   int    `json:"devices"`
	Untriaged int    `json:"untriaged"`
}

// ListOrgs (staff) returns every customer with its AssetHub device +
// untriaged-finding counts, for the admin org switcher / landing table.
func (h *Handler) ListOrgs(w http.ResponseWriter, r *http.Request) {
	rows, err := h.DB.Query(r.Context(), `
		SELECT c.id, c.slug, c.name,
		  (SELECT COUNT(*) FROM assethub_devices d WHERE d.customer_id = c.id) AS devices,
		  (SELECT COUNT(*) FROM assethub_discovery_findings f WHERE f.customer_id = c.id AND f.status='untriaged') AS untriaged
		FROM customers c
		WHERE c.is_active
		ORDER BY c.name`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()
	out := []org{}
	for rows.Next() {
		var o org
		if err := rows.Scan(&o.ID, &o.Slug, &o.Name, &o.Devices, &o.Untriaged); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan failed")
			return
		}
		out = append(out, o)
	}
	writeJSON(w, http.StatusOK, out)
}
