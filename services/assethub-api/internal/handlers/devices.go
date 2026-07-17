package handlers

import (
	"context"
	"encoding/csv"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	mw "github.com/f2cothai/f2-website/services/assethub-api/internal/middleware"
	"github.com/f2cothai/f2-website/services/assethub-api/internal/models"
)

// ListDevices returns the filtered device register for one customer.
// Filters (query params): type, site_id, os, network_role, status, q.
func (h *Handler) ListDevices(w http.ResponseWriter, r *http.Request) {
	customerID := h.scopeCustomer(r)
	if customerID == "" {
		writeErr(w, http.StatusBadRequest, "customer_id required")
		return
	}
	devs, err := h.queryDevices(r.Context(), customerID, r.URL.Query())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query failed: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, devs)
}

// queryDevices builds the filtered SELECT. Every query is scoped to
// customerID (tenant isolation lives in SQL, never the handler).
func (h *Handler) queryDevices(ctx context.Context, customerID string, q map[string][]string) ([]models.Device, error) {
	where := []string{"d.customer_id = $1"}
	args := []any{customerID}
	add := func(clause string, val any) {
		args = append(args, val)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}
	get := func(k string) string { return strings.TrimSpace(first(q[k])) }

	if v := get("type"); v != "" {
		add("d.device_type = $%d", v)
	}
	if cat := get("category"); cat != "" {
		if types := categoryTypes(cat); len(types) > 0 {
			add("d.device_type = ANY($%d)", types)
		}
	}
	if v := get("site_id"); v != "" {
		add("d.site_id = $%d", v)
	}
	if v := get("network_role"); v != "" {
		add("d.network_role = $%d", v)
	}
	if v := get("status"); v != "" {
		add("d.status = $%d", v)
	}
	if v := get("os"); v != "" {
		add("d.os_name ILIKE '%%' || $%d || '%%'", v)
	}
	if v := get("q"); v != "" {
		args = append(args, v)
		i := len(args)
		where = append(where, fmt.Sprintf(
			"(d.hostname ILIKE '%%'||$%d||'%%' OR d.serial_number ILIKE '%%'||$%d||'%%' OR d.primary_ip ILIKE '%%'||$%d||'%%' OR d.model ILIKE '%%'||$%d||'%%')",
			i, i, i, i))
	}

	sql := `
		SELECT d.id, d.customer_id, d.site_id, s.name, d.device_type, d.hostname, d.brand, d.model,
		       d.serial_number, d.asset_tag, d.os_name, d.os_version, d.cpu, d.ram_mb, d.storage_summary,
		       d.network_role, d.domain_or_workgroup_name, d.primary_mac, d.primary_ip, d.assigned_user,
		       d.status, d.source, d.first_seen, d.last_seen, d.notes, d.created_at, d.updated_at
		FROM assethub_devices d
		LEFT JOIN assethub_sites s ON s.id = d.site_id
		WHERE ` + strings.Join(where, " AND ") + `
		ORDER BY d.last_seen DESC`

	rows, err := h.DB.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.Device{}
	for rows.Next() {
		d, err := scanDevice(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// categoryTypes maps a UI section to the device_types it covers. Sections are
// views over the one device table (keyed by device_type), not separate
// modules/tables — this is the single source of truth for that grouping, so
// the admin/portal chips and any future per-section routes stay consistent.
func categoryTypes(cat string) []string {
	switch cat {
	case "network":
		return []string{"router", "switch", "ap", "nas"}
	case "computers":
		return []string{"computer", "server", "phone", "tablet"}
	case "cctv":
		return []string{"camera"}
	case "printers":
		return []string{"printer", "iot", "unknown"}
	default:
		return nil
	}
}

// GetDevice returns one device with interfaces/disks/software.
func (h *Handler) GetDevice(w http.ResponseWriter, r *http.Request) {
	customerID := h.scopeCustomer(r)
	if customerID == "" {
		writeErr(w, http.StatusBadRequest, "customer_id required")
		return
	}
	id := chi.URLParam(r, "id")
	ctx := r.Context()
	row := h.DB.QueryRow(ctx, `
		SELECT d.id, d.customer_id, d.site_id, s.name, d.device_type, d.hostname, d.brand, d.model,
		       d.serial_number, d.asset_tag, d.os_name, d.os_version, d.cpu, d.ram_mb, d.storage_summary,
		       d.network_role, d.domain_or_workgroup_name, d.primary_mac, d.primary_ip, d.assigned_user,
		       d.status, d.source, d.first_seen, d.last_seen, d.notes, d.created_at, d.updated_at
		FROM assethub_devices d
		LEFT JOIN assethub_sites s ON s.id = d.site_id
		WHERE d.id=$1 AND d.customer_id=$2`, id, customerID)
	d, err := scanDevice(row)
	if err != nil {
		writeErr(w, http.StatusNotFound, "device not found")
		return
	}
	d.Interfaces, _ = h.loadInterfaces(ctx, id)
	d.Disks, _ = h.loadDisks(ctx, id)
	d.Software, _ = h.loadSoftware(ctx, id)
	writeJSON(w, http.StatusOK, d)
}

type devicepatch struct {
	DeviceType   *string `json:"device_type"`
	AssetTag     *string `json:"asset_tag"`
	AssignedUser *string `json:"assigned_user"`
	SiteID       *string `json:"site_id"`
	Status       *string `json:"status"`
	Notes        *string `json:"notes"`
}

// PatchDevice (staff) lets an engineer enrich a device: type, asset tag,
// assigned user, site, status, notes. Discovery/agent fields are left alone.
func (h *Handler) PatchDevice(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var p devicepatchInput
	if err := decode(w, r, &p); err != nil {
		return
	}
	ctx := r.Context()
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `
		UPDATE assethub_devices SET
		  device_type   = COALESCE($2, device_type),
		  asset_tag     = COALESCE($3, asset_tag),
		  assigned_user = COALESCE($4, assigned_user),
		  site_id       = COALESCE($5, site_id),
		  status        = COALESCE($6, status),
		  notes         = COALESCE($7, notes)
		WHERE id=$1`,
		id, p.DeviceType, p.AssetTag, p.AssignedUser, p.SiteID, p.Status, p.Notes)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "update failed")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "device not found")
		return
	}
	_ = writeAudit(ctx, tx, "assethub_device", id, mw.UserID(ctx), "update", map[string]any{})
	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": id})
}

// devicepatchInput mirrors devicepatch but tolerates empty strings meaning
// "clear" vs absent meaning "leave". For MVP we treat empty as no-op (COALESCE).
type devicepatchInput = devicepatch

// DeleteDevice (admin only).
func (h *Handler) DeleteDevice(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ctx := r.Context()
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `DELETE FROM assethub_devices WHERE id=$1`, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "delete failed")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "device not found")
		return
	}
	_ = writeAudit(ctx, tx, "assethub_device", id, mw.UserID(ctx), "delete", map[string]any{})
	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DeviceHistory returns the submission timeline for one device.
func (h *Handler) DeviceHistory(w http.ResponseWriter, r *http.Request) {
	customerID := h.scopeCustomer(r)
	id := chi.URLParam(r, "id")
	// Cast timestamps to text so they scan into Go strings (pgx won't scan a
	// timestamptz straight into *string).
	rows, err := h.DB.Query(r.Context(), `
		SELECT id, source, collected_at::text, received_at::text
		FROM assethub_submissions
		WHERE device_id=$1 AND customer_id=$2
		ORDER BY received_at DESC LIMIT 100`, id, customerID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()
	type ev struct {
		ID          string  `json:"id"`
		Source      string  `json:"source"`
		CollectedAt *string `json:"collected_at"`
		ReceivedAt  string  `json:"received_at"`
	}
	out := []ev{}
	for rows.Next() {
		var e ev
		var collected *string
		var received string
		if err := rows.Scan(&e.ID, &e.Source, &collected, &received); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan failed")
			return
		}
		e.CollectedAt = collected
		e.ReceivedAt = received
		out = append(out, e)
	}
	writeJSON(w, http.StatusOK, out)
}

// ExportDevicesCSV streams the filtered register as CSV (quick export on any list).
func (h *Handler) ExportDevicesCSV(w http.ResponseWriter, r *http.Request) {
	customerID := h.scopeCustomer(r)
	if customerID == "" {
		writeErr(w, http.StatusBadRequest, "customer_id required")
		return
	}
	devs, err := h.queryDevices(r.Context(), customerID, r.URL.Query())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query failed")
		return
	}
	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", "attachment; filename=assethub-devices.csv")
	cw := csv.NewWriter(w)
	_ = cw.Write([]string{"hostname", "type", "brand", "model", "serial", "os", "cpu", "ram_mb", "network_role", "domain_workgroup", "primary_ip", "primary_mac", "status", "last_seen"})
	for _, d := range devs {
		_ = cw.Write([]string{
			deref(d.Hostname), d.DeviceType, deref(d.Brand), deref(d.Model), deref(d.SerialNumber),
			join(deref(d.OSName), deref(d.OSVersion)), deref(d.CPU), intStr(d.RAMMB), d.NetworkRole,
			deref(d.DomainOrWorkgroupName), deref(d.PrimaryIP), deref(d.PrimaryMAC), d.Status,
			d.LastSeen.Format("2006-01-02 15:04"),
		})
	}
	cw.Flush()
}

// ---- child loaders ----

func (h *Handler) loadInterfaces(ctx context.Context, deviceID string) ([]models.Iface, error) {
	rows, err := h.DB.Query(ctx, `SELECT name, mac, ipv4, ipv6, type, ssid FROM assethub_device_interfaces WHERE device_id=$1 ORDER BY name`, deviceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.Iface{}
	for rows.Next() {
		var i models.Iface
		if err := rows.Scan(&i.Name, &i.MAC, &i.IPv4, &i.IPv6, &i.Type, &i.SSID); err != nil {
			return nil, err
		}
		out = append(out, i)
	}
	return out, nil
}

func (h *Handler) loadDisks(ctx context.Context, deviceID string) ([]models.Disk, error) {
	rows, err := h.DB.Query(ctx, `SELECT model, size_gb, free_gb, type, smart_status FROM assethub_device_disks WHERE device_id=$1`, deviceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.Disk{}
	for rows.Next() {
		var d models.Disk
		if err := rows.Scan(&d.Model, &d.SizeGB, &d.FreeGB, &d.Type, &d.Smart); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, nil
}

func (h *Handler) loadSoftware(ctx context.Context, deviceID string) ([]models.Software, error) {
	rows, err := h.DB.Query(ctx, `SELECT name, version, vendor FROM assethub_device_software WHERE device_id=$1 ORDER BY name`, deviceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.Software{}
	for rows.Next() {
		var s models.Software
		if err := rows.Scan(&s.Name, &s.Version, &s.Vendor); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, nil
}

// scanDevice scans the standard device column list from a Row or Rows.
func scanDevice(s scanner) (models.Device, error) {
	var d models.Device
	err := s.Scan(&d.ID, &d.CustomerID, &d.SiteID, &d.SiteName, &d.DeviceType, &d.Hostname, &d.Brand, &d.Model,
		&d.SerialNumber, &d.AssetTag, &d.OSName, &d.OSVersion, &d.CPU, &d.RAMMB, &d.StorageSummary,
		&d.NetworkRole, &d.DomainOrWorkgroupName, &d.PrimaryMAC, &d.PrimaryIP, &d.AssignedUser,
		&d.Status, &d.Source, &d.FirstSeen, &d.LastSeen, &d.Notes, &d.CreatedAt, &d.UpdatedAt)
	return d, err
}

// scanner unifies pgx.Row and pgx.Rows for scanDevice.
type scanner interface {
	Scan(dest ...any) error
}

// ---- tiny format helpers for CSV ----

func first(vs []string) string {
	if len(vs) == 0 {
		return ""
	}
	return vs[0]
}
func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
func intStr(p *int) string {
	if p == nil {
		return ""
	}
	return fmt.Sprintf("%d", *p)
}
func join(a, b string) string {
	return strings.TrimSpace(strings.TrimSpace(a + " " + b))
}
