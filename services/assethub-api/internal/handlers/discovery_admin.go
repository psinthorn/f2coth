package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	mw "github.com/f2cothai/f2-website/services/assethub-api/internal/middleware"
	"github.com/f2cothai/f2-website/services/assethub-api/internal/models"
)

// ListFindings returns discovery findings for a customer, newest first.
// Query params: status (default 'untriaged'), site_id.
func (h *Handler) ListFindings(w http.ResponseWriter, r *http.Request) {
	customerID := h.scopeCustomer(r)
	if customerID == "" {
		writeErr(w, http.StatusBadRequest, "customer_id required")
		return
	}
	status := r.URL.Query().Get("status")
	args := []any{customerID}
	sql := `SELECT id, run_id, site_id, ip, mac, vendor, hostname, open_ports, snmp_sysdescr,
	               suggested_type, status, device_id, created_at
	        FROM assethub_discovery_findings WHERE customer_id=$1`
	if status != "" {
		args = append(args, status)
		sql += " AND status=$2"
	}
	sql += " ORDER BY created_at DESC LIMIT 500"

	rows, err := h.DB.Query(r.Context(), sql, args...)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()
	out := []models.Finding{}
	for rows.Next() {
		var f models.Finding
		if err := rows.Scan(&f.ID, &f.RunID, &f.SiteID, &f.IP, &f.MAC, &f.Vendor, &f.Hostname,
			&f.OpenPorts, &f.SNMPSysDescr, &f.SuggestedType, &f.Status, &f.DeviceID, &f.CreatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan failed")
			return
		}
		out = append(out, f)
	}
	writeJSON(w, http.StatusOK, out)
}

type promoteReq struct {
	DeviceType string `json:"device_type"`
	SiteID     string `json:"site_id"`
}

// PromoteFinding (staff) turns an untriaged finding into a device asset,
// classifying its type. The finding is linked to the new device.
func (h *Handler) PromoteFinding(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req promoteReq
	if err := decode(w, r, &req); err != nil {
		return
	}
	ctx := r.Context()
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer tx.Rollback(ctx)

	var (
		customerID, siteID, ip, mac, vendor, hostname string
		siteIDPtr, macPtr, ipPtr, hostPtr, vendPtr    *string
	)
	err = tx.QueryRow(ctx, `
		SELECT customer_id, site_id, ip, mac, vendor, hostname
		FROM assethub_discovery_findings WHERE id=$1 AND status='untriaged'`, id).
		Scan(&customerID, &siteIDPtr, &ipPtr, &macPtr, &vendPtr, &hostPtr)
	if err != nil {
		writeErr(w, http.StatusNotFound, "finding not found or already triaged")
		return
	}
	siteID = req.SiteID
	if siteID == "" && siteIDPtr != nil {
		siteID = *siteIDPtr
	}
	ip, mac, vendor, hostname = deref(ipPtr), deref(macPtr), deref(vendPtr), deref(hostPtr)

	var deviceID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO assethub_devices (customer_id, site_id, device_type, hostname, brand, primary_mac, primary_ip, source, network_role)
		VALUES ($1, $2, $3, $4, $5, $6, $7, 'probe', 'n/a') RETURNING id`,
		customerID, nilIfEmpty(siteID), suggestType(req.DeviceType), nilIfEmpty(hostname),
		nilIfEmpty(vendor), nilIfEmpty(mac), nilIfEmpty(ip)).Scan(&deviceID); err != nil {
		writeErr(w, http.StatusInternalServerError, "create device failed")
		return
	}
	if err := h.assignAssetTagIfEmpty(ctx, tx, deviceID, customerID, suggestType(req.DeviceType), "", ""); err != nil {
		writeErr(w, http.StatusInternalServerError, "asset tag failed")
		return
	}
	if _, err := tx.Exec(ctx, `UPDATE assethub_discovery_findings SET status='promoted', device_id=$2 WHERE id=$1`, id, deviceID); err != nil {
		writeErr(w, http.StatusInternalServerError, "update finding failed")
		return
	}
	_ = writeAudit(ctx, tx, "assethub_device", deviceID, mw.UserID(ctx), "promote", map[string]any{"finding_id": id})
	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"device_id": deviceID})
}

// IgnoreFinding (staff) dismisses a finding from the triage queue.
func (h *Handler) IgnoreFinding(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	tag, err := h.DB.Exec(r.Context(), `UPDATE assethub_discovery_findings SET status='ignored' WHERE id=$1 AND status='untriaged'`, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "update failed")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "finding not found or already triaged")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
