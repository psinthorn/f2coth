package handlers

import (
	"net/http"
	"strings"
)

type enrollReq struct {
	DeviceType   string `json:"device_type"`
	Hostname     string `json:"hostname"`
	Brand        string `json:"brand"`
	Model        string `json:"model"`
	SerialNumber string `json:"serial_number"`
	PrimaryMAC   string `json:"primary_mac"`
	AssignedUser string `json:"assigned_user"`
	Notes        string `json:"notes"`
}

// EnrollDevice backs the mobile /enroll self-registration form (spec §7).
// Auth is by enrollment token (same as ingest), so a phone/tablet can be
// registered in 60 seconds without a login. Creates a source='manual' device
// (deduped by serial → MAC → hostname); manual data never clobbers a richer
// agent record's inventory, it only fills identity + assignment fields.
func (h *Handler) EnrollDevice(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	scope, err := h.resolveToken(ctx, r)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "invalid enrollment token")
		return
	}
	var req enrollReq
	if err := decode(w, r, &req); err != nil {
		return
	}
	mac := strings.ToLower(strings.TrimSpace(req.PrimaryMAC))

	tx, err := h.DB.Begin(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer tx.Rollback(ctx)

	var deviceID string
	if s := strings.TrimSpace(req.SerialNumber); s != "" {
		_ = tx.QueryRow(ctx, `SELECT id FROM assethub_devices WHERE customer_id=$1 AND serial_number=$2`, scope.CustomerID, s).Scan(&deviceID)
	}
	if deviceID == "" && mac != "" {
		_ = tx.QueryRow(ctx, `SELECT id FROM assethub_devices WHERE customer_id=$1 AND primary_mac=$2`, scope.CustomerID, mac).Scan(&deviceID)
	}
	if deviceID == "" && strings.TrimSpace(req.Hostname) != "" {
		_ = tx.QueryRow(ctx, `SELECT id FROM assethub_devices WHERE customer_id=$1 AND lower(hostname)=lower($2)`, scope.CustomerID, req.Hostname).Scan(&deviceID)
	}

	action := "updated"
	if deviceID == "" {
		action = "created"
		if err := tx.QueryRow(ctx, `
			INSERT INTO assethub_devices
			  (customer_id, site_id, device_type, hostname, brand, model, serial_number, primary_mac, assigned_user, notes, source, network_role)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'manual','n/a') RETURNING id`,
			scope.CustomerID, scope.SiteID, normDeviceTypeManual(req.DeviceType), nilIfEmpty(req.Hostname),
			nilIfEmpty(req.Brand), nilIfEmpty(req.Model), nilIfEmpty(req.SerialNumber), nilIfEmpty(mac),
			nilIfEmpty(req.AssignedUser), nilIfEmpty(req.Notes)).Scan(&deviceID); err != nil {
			writeErr(w, http.StatusInternalServerError, "create failed: "+err.Error())
			return
		}
		if err := h.assignAssetTagIfEmpty(ctx, tx, deviceID, scope.CustomerID, normDeviceTypeManual(req.DeviceType), req.Model, ""); err != nil {
			writeErr(w, http.StatusInternalServerError, "asset tag failed")
			return
		}
	} else {
		if _, err := tx.Exec(ctx, `
			UPDATE assethub_devices SET
			  device_type   = $2,
			  assigned_user = COALESCE(NULLIF($3,''), assigned_user),
			  notes         = COALESCE(NULLIF($4,''), notes),
			  asset_tag     = asset_tag,
			  last_seen     = NOW()
			WHERE id=$1`,
			deviceID, normDeviceTypeManual(req.DeviceType), req.AssignedUser, req.Notes); err != nil {
			writeErr(w, http.StatusInternalServerError, "update failed")
			return
		}
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO assethub_submissions (customer_id, site_id, device_id, token_id, source, payload)
		VALUES ($1,$2,$3,$4,'manual','{}'::jsonb)`,
		scope.CustomerID, scope.SiteID, deviceID, scope.TokenID); err != nil {
		writeErr(w, http.StatusInternalServerError, "store submission failed")
		return
	}
	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"device_id": deviceID, "action": action})
}

// normDeviceTypeManual defaults manual enrollments to 'phone' (the common
// case for the mobile form) rather than 'computer'.
func normDeviceTypeManual(t string) string {
	t = strings.ToLower(strings.TrimSpace(t))
	if validDeviceTypes[t] {
		return t
	}
	return "phone"
}
