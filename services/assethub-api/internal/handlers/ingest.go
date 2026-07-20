package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/f2cothai/f2-website/services/assethub-api/internal/models"
)

const maxIngestBody = 2 << 20 // 2 MB (spec §2 rate/size caps)

// tokenScope is the resolved tenant context for a pushing client.
type tokenScope struct {
	TokenID    string
	CustomerID string
	SiteID     *string
}

var errNoToken = errors.New("missing token")

// resolveToken validates the Bearer enrollment token against the peppered
// hash and returns the tenant scope. Lookup is by hash equality on an indexed
// column (constant-time at the DB level) and only matches non-revoked rows.
func (h *Handler) resolveToken(ctx context.Context, r *http.Request) (tokenScope, error) {
	bearer := r.Header.Get("Authorization")
	if !strings.HasPrefix(bearer, "Bearer ") {
		return tokenScope{}, errNoToken
	}
	plaintext := strings.TrimSpace(strings.TrimPrefix(bearer, "Bearer "))
	if plaintext == "" {
		return tokenScope{}, errNoToken
	}
	hash := hashToken(h.TokenPepper, plaintext)

	var sc tokenScope
	err := h.DB.QueryRow(ctx, `
		SELECT id, customer_id, site_id
		FROM assethub_enrollment_tokens
		WHERE token_hash = $1 AND revoked_at IS NULL`, hash).
		Scan(&sc.TokenID, &sc.CustomerID, &sc.SiteID)
	if err != nil {
		return tokenScope{}, err
	}
	// Best-effort last-used stamp; never block ingest on it.
	_, _ = h.DB.Exec(ctx, `UPDATE assethub_enrollment_tokens SET last_used_at = NOW() WHERE id = $1`, sc.TokenID)
	return sc, nil
}

// Ingest handles POST /api/assethub/ingest — a single computer collector
// payload (f2.assethub.v1). Auth is by enrollment token (not JWT).
func (h *Handler) Ingest(w http.ResponseWriter, r *http.Request) {
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

	var env models.IngestEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		writeErr(w, http.StatusUnprocessableEntity, "malformed JSON")
		return
	}
	if env.Schema != models.SchemaV1 {
		writeErr(w, http.StatusUnprocessableEntity, "unsupported schema; expected "+models.SchemaV1)
		return
	}

	collectedAt := parseTime(env.CollectedAt)
	primaryMAC, primaryIP := primaryNet(env.Device.Interfaces)

	tx, err := h.DB.Begin(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer tx.Rollback(ctx)

	deviceID, action, err := h.mergeDevice(ctx, tx, scope, env.Device, primaryMAC, primaryIP, string(body))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "merge failed: "+err.Error())
		return
	}
	// New collector devices get a default asset tag (existing ones keep theirs).
	if action == "created" {
		if err := h.assignAssetTagIfEmpty(ctx, tx, deviceID, scope.CustomerID, env.Device.DeviceType, env.Device.Model, env.Device.OS.Name); err != nil {
			writeErr(w, http.StatusInternalServerError, "asset tag failed: "+err.Error())
			return
		}
	}

	// Store the full raw submission (audit trail + "changes since last visit").
	if _, err := tx.Exec(ctx, `
		INSERT INTO assethub_submissions (customer_id, site_id, device_id, token_id, source, collected_at, payload)
		VALUES ($1, $2, $3, $4, 'agent', $5, $6::jsonb)`,
		scope.CustomerID, scope.SiteID, deviceID, scope.TokenID, collectedAt, string(body)); err != nil {
		writeErr(w, http.StatusInternalServerError, "store submission failed")
		return
	}

	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"device_id": deviceID, "action": action})
}

// mergeDevice upserts a device using identity precedence serial → MAC →
// hostname+customer (spec §5). Agent data outranks probe data, so the row's
// source is set to 'agent'. Child rows (interfaces/disks/software) are fully
// replaced to reflect the latest snapshot.
func (h *Handler) mergeDevice(ctx context.Context, tx pgx.Tx, scope tokenScope, d models.IngestDevice, primaryMAC, primaryIP, raw string) (string, string, error) {
	deviceType := normDeviceType(d.DeviceType)
	networkRole := normNetworkRole(d.NetworkRole)
	storage := summarizeDisks(d.Disks)

	var deviceID string
	// 1. serial
	if s := strings.TrimSpace(d.SerialNumber); s != "" {
		_ = tx.QueryRow(ctx, `SELECT id FROM assethub_devices WHERE customer_id=$1 AND serial_number=$2`,
			scope.CustomerID, s).Scan(&deviceID)
	}
	// 2. primary MAC
	if deviceID == "" && primaryMAC != "" {
		_ = tx.QueryRow(ctx, `SELECT id FROM assethub_devices WHERE customer_id=$1 AND primary_mac=$2`,
			scope.CustomerID, primaryMAC).Scan(&deviceID)
	}
	// 3. hostname + customer
	if deviceID == "" && strings.TrimSpace(d.Hostname) != "" {
		_ = tx.QueryRow(ctx, `SELECT id FROM assethub_devices WHERE customer_id=$1 AND lower(hostname)=lower($2)`,
			scope.CustomerID, d.Hostname).Scan(&deviceID)
	}

	action := "updated"
	if deviceID == "" {
		action = "created"
		err := tx.QueryRow(ctx, `
			INSERT INTO assethub_devices
			  (customer_id, site_id, device_type, hostname, brand, model, serial_number,
			   os_name, os_version, cpu, ram_mb, storage_summary, network_role,
			   domain_or_workgroup_name, primary_mac, primary_ip, assigned_user, source, raw)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'agent',$18::jsonb)
			RETURNING id`,
			scope.CustomerID, scope.SiteID, deviceType, nilIfEmpty(d.Hostname), nilIfEmpty(d.Brand),
			nilIfEmpty(d.Model), nilIfEmpty(d.SerialNumber), nilIfEmpty(d.OS.Name), nilIfEmpty(d.OS.Version),
			nilIfEmpty(d.CPU), nilIfZero(d.RAMMB), nilIfEmpty(storage), networkRole,
			nilIfEmpty(d.DomainOrWorkgroupName), nilIfEmpty(primaryMAC), nilIfEmpty(primaryIP),
			nilIfEmpty(d.LoggedInUser), raw,
		).Scan(&deviceID)
		if err != nil {
			return "", "", err
		}
	} else {
		_, err := tx.Exec(ctx, `
			UPDATE assethub_devices SET
			  site_id = COALESCE($2, site_id),
			  device_type = $3, hostname = $4, brand = $5, model = $6, serial_number = $7,
			  os_name = $8, os_version = $9, cpu = $10, ram_mb = $11, storage_summary = $12,
			  network_role = $13, domain_or_workgroup_name = $14, primary_mac = $15, primary_ip = $16,
			  assigned_user = COALESCE($17, assigned_user), source = 'agent', raw = $18::jsonb,
			  last_seen = NOW(), status = 'active'
			WHERE id = $1`,
			deviceID, scope.SiteID, deviceType, nilIfEmpty(d.Hostname), nilIfEmpty(d.Brand),
			nilIfEmpty(d.Model), nilIfEmpty(d.SerialNumber), nilIfEmpty(d.OS.Name), nilIfEmpty(d.OS.Version),
			nilIfEmpty(d.CPU), nilIfZero(d.RAMMB), nilIfEmpty(storage), networkRole,
			nilIfEmpty(d.DomainOrWorkgroupName), nilIfEmpty(primaryMAC), nilIfEmpty(primaryIP),
			nilIfEmpty(d.LoggedInUser), raw,
		)
		if err != nil {
			return "", "", err
		}
	}

	// Replace child rows.
	for _, t := range []string{"assethub_device_interfaces", "assethub_device_disks", "assethub_device_software"} {
		if _, err := tx.Exec(ctx, "DELETE FROM "+t+" WHERE device_id=$1", deviceID); err != nil {
			return "", "", err
		}
	}
	for _, i := range d.Interfaces {
		if _, err := tx.Exec(ctx, `
			INSERT INTO assethub_device_interfaces (device_id, name, mac, ipv4, ipv6, type, ssid)
			VALUES ($1,$2,$3,$4,$5,$6,$7)`,
			deviceID, nilIfEmpty(i.Name), nilIfEmpty(strings.ToLower(i.MAC)), arr(i.IPv4), arr(i.IPv6),
			nilIfEmpty(i.Type), nilIfEmpty(i.SSID)); err != nil {
			return "", "", err
		}
	}
	for _, dk := range d.Disks {
		if _, err := tx.Exec(ctx, `
			INSERT INTO assethub_device_disks (device_id, model, size_gb, free_gb, type, smart_status)
			VALUES ($1,$2,$3,$4,$5,$6)`,
			deviceID, nilIfEmpty(dk.Model), dk.SizeGB, dk.FreeGB, nilIfEmpty(dk.Type),
			nilIfEmpty(dk.Smart)); err != nil {
			return "", "", err
		}
	}
	for _, s := range d.Software {
		if strings.TrimSpace(s.Name) == "" {
			continue
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO assethub_device_software (device_id, name, version, vendor)
			VALUES ($1,$2,$3,$4)`,
			deviceID, s.Name, nilIfEmpty(s.Version), nilIfEmpty(s.Vendor)); err != nil {
			return "", "", err
		}
	}
	return deviceID, action, nil
}

// ---- small pure helpers (unit-tested in ingest_test.go) ----

func nilIfZero(n int) *int {
	if n == 0 {
		return nil
	}
	return &n
}

// arr coalesces a nil slice to an empty one so it stores as a SQL empty array
// ('{}') rather than NULL against a NOT NULL TEXT[] column.
func arr(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func parseTime(s string) *time.Time {
	if s == "" {
		return nil
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return &t
	}
	return nil
}

// primaryNet picks the primary MAC + IPv4 from a device's interfaces: the
// first ethernet/wifi NIC that carries an IPv4, else the first with a MAC.
func primaryNet(ifaces []models.IngestIface) (string, string) {
	for _, i := range ifaces {
		if i.MAC != "" && len(i.IPv4) > 0 && i.IPv4[0] != "" {
			return strings.ToLower(i.MAC), i.IPv4[0]
		}
	}
	for _, i := range ifaces {
		if i.MAC != "" {
			ip := ""
			if len(i.IPv4) > 0 {
				ip = i.IPv4[0]
			}
			return strings.ToLower(i.MAC), ip
		}
	}
	return "", ""
}

var validDeviceTypes = map[string]bool{
	"computer": true, "server": true, "nas": true, "router": true, "switch": true,
	"ap": true, "printer": true, "camera": true, "phone": true, "tablet": true,
	"iot": true, "unknown": true,
}

func normDeviceType(t string) string {
	t = strings.ToLower(strings.TrimSpace(t))
	if validDeviceTypes[t] {
		return t
	}
	return "computer" // collectors only run on computers/servers
}

func normNetworkRole(r string) string {
	r = strings.ToLower(strings.TrimSpace(r))
	switch r {
	case "domain", "workgroup", "standalone":
		return r
	default:
		return "n/a"
	}
}

func summarizeDisks(disks []models.IngestDisk) string {
	if len(disks) == 0 {
		return ""
	}
	parts := make([]string, 0, len(disks))
	for _, d := range disks {
		seg := d.Model
		if d.SizeGB > 0 {
			seg = strings.TrimSpace(seg + " " + trimFloat(d.SizeGB) + "GB")
		}
		if d.Type != "" {
			seg = strings.TrimSpace(seg + " " + d.Type)
		}
		if seg != "" {
			parts = append(parts, seg)
		}
	}
	return strings.Join(parts, "; ")
}

func trimFloat(f float64) string {
	s := strings.TrimRight(strings.TrimRight(strconv.FormatFloat(f, 'f', 1, 64), "0"), ".")
	if s == "" {
		return "0"
	}
	return s
}
