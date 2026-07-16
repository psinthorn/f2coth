package handlers

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/f2cothai/f2-website/services/assethub-api/internal/models"
)

// Discovery handles POST /api/assethub/discovery — a probe scan result.
// Auth is by the same enrollment token as ingest. Findings are stored as a
// run; each is auto-matched to an existing device by MAC, and unmatched
// findings land in the triage queue (status='untriaged').
func (h *Handler) Discovery(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	scope, err := h.resolveToken(ctx, r)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "invalid enrollment token")
		return
	}

	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxIngestBody))
	if err != nil {
		writeErr(w, http.StatusRequestEntityTooLarge, "payload too large (max 2 MB)")
		return
	}
	var env models.DiscoveryEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		writeErr(w, http.StatusUnprocessableEntity, "malformed JSON")
		return
	}
	switch env.Schema {
	case "", models.SchemaV1, "f2.assethub.discovery.v1":
	default:
		writeErr(w, http.StatusUnprocessableEntity, "unsupported discovery schema")
		return
	}

	tx, err := h.DB.Begin(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer tx.Rollback(ctx)

	var runID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO assethub_discovery_runs (customer_id, site_id, token_id, started_at, finding_count, raw)
		VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING id`,
		scope.CustomerID, scope.SiteID, scope.TokenID, parseTime(env.StartedAt), len(env.Findings), string(body),
	).Scan(&runID); err != nil {
		writeErr(w, http.StatusInternalServerError, "store run failed")
		return
	}

	matched := 0
	for _, f := range env.Findings {
		mac := strings.ToLower(strings.TrimSpace(f.MAC))
		var deviceID *string
		status := "untriaged"
		if mac != "" {
			var id string
			// Match on the device's primary MAC or any of its interfaces.
			err := tx.QueryRow(ctx, `
				SELECT d.id FROM assethub_devices d
				WHERE d.customer_id = $1 AND (
				  d.primary_mac = $2 OR EXISTS (
				    SELECT 1 FROM assethub_device_interfaces i WHERE i.device_id = d.id AND i.mac = $2))
				LIMIT 1`, scope.CustomerID, mac).Scan(&id)
			if err == nil && id != "" {
				deviceID = &id
				status = "promoted"
				matched++
			}
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO assethub_discovery_findings
			  (run_id, customer_id, site_id, ip, mac, vendor, hostname, open_ports, snmp_sysdescr, suggested_type, status, device_id)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
			runID, scope.CustomerID, scope.SiteID, nilIfEmpty(f.IP), nilIfEmpty(mac), nilIfEmpty(f.Vendor),
			nilIfEmpty(f.Hostname), nilIfEmpty(f.OpenPorts), nilIfEmpty(f.SNMPSysDescr),
			suggestType(f.Type()), status, deviceID); err != nil {
			writeErr(w, http.StatusInternalServerError, "store finding failed")
			return
		}
	}

	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"run_id":   runID,
		"findings": len(env.Findings),
		"matched":  matched,
	})
}

func suggestType(t string) string {
	t = strings.ToLower(strings.TrimSpace(t))
	if validDeviceTypes[t] {
		return t
	}
	return "unknown"
}
