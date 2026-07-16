package handlers

import (
	"context"
	"net/http"
)

// Overview returns dashboard stat aggregates for one customer: totals, type
// breakdown, OS breakdown, network-role split, new/stale counts, and the
// untriaged discovery-queue size (spec §8).
func (h *Handler) Overview(w http.ResponseWriter, r *http.Request) {
	customerID := h.scopeCustomer(r)
	if customerID == "" {
		writeErr(w, http.StatusBadRequest, "customer_id required")
		return
	}
	ctx := r.Context()

	out := map[string]any{
		"customer_id": customerID,
	}

	// Headline counts.
	var total, new30, stale30, untriaged int
	_ = h.DB.QueryRow(ctx, `SELECT COUNT(*) FROM assethub_devices WHERE customer_id=$1`, customerID).Scan(&total)
	_ = h.DB.QueryRow(ctx, `SELECT COUNT(*) FROM assethub_devices WHERE customer_id=$1 AND first_seen > NOW() - INTERVAL '30 days'`, customerID).Scan(&new30)
	_ = h.DB.QueryRow(ctx, `SELECT COUNT(*) FROM assethub_devices WHERE customer_id=$1 AND last_seen < NOW() - INTERVAL '30 days'`, customerID).Scan(&stale30)
	_ = h.DB.QueryRow(ctx, `SELECT COUNT(*) FROM assethub_discovery_findings WHERE customer_id=$1 AND status='untriaged'`, customerID).Scan(&untriaged)
	out["total"] = total
	out["new_30d"] = new30
	out["stale_30d"] = stale30
	out["untriaged"] = untriaged

	out["by_type"] = h.groupCount(ctx, customerID, "device_type")
	out["by_network_role"] = h.groupCount(ctx, customerID, "network_role")
	out["by_os"] = h.groupCount(ctx, customerID, "COALESCE(os_name, 'Unknown')")

	writeJSON(w, http.StatusOK, out)
}

type bucket struct {
	Label string `json:"label"`
	Count int    `json:"count"`
}

// groupCount returns COUNT(*) grouped by an (already-safe) column expression.
// The expr is never user-controlled — only the fixed strings above are passed.
func (h *Handler) groupCount(ctx context.Context, customerID, expr string) []bucket {
	rows, err := h.DB.Query(ctx,
		`SELECT `+expr+` AS label, COUNT(*) AS n FROM assethub_devices WHERE customer_id=$1 GROUP BY 1 ORDER BY 2 DESC`,
		customerID)
	if err != nil {
		return []bucket{}
	}
	defer rows.Close()
	out := []bucket{}
	for rows.Next() {
		var b bucket
		if err := rows.Scan(&b.Label, &b.Count); err != nil {
			return out
		}
		out = append(out, b)
	}
	return out
}
