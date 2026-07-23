package handlers

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

// Asset-tag scheme:  PREFIX-CCC-SSS-NNN   e.g.  DPV-001-002-001
//   PREFIX = per-client code (customers.asset_tag_prefix)
//   CCC    = category code (device type)
//   SSS    = sub-type code (best-effort from type + OS/model; editable)
//   NNN    = running number, per (org, category), zero-padded to 3

// categoryCode maps a device_type to its 3-digit category segment.
var categoryCode = map[string]string{
	"computer": "001", "server": "002", "nas": "003", "router": "004",
	"switch": "005", "ap": "006", "printer": "007", "camera": "008",
	"phone": "009", "tablet": "010", "iot": "011",
	"monitor": "012", "ups": "013", "keyboard": "014", "mouse": "015", "dock": "016",
	"unknown": "099",
}

func catCode(deviceType string) string {
	if c, ok := categoryCode[strings.ToLower(strings.TrimSpace(deviceType))]; ok {
		return c
	}
	return "099"
}

// subCode is a best-effort sub-type from what we know. The data model has no
// laptop-vs-desktop field, so for computers we infer from model/OS hints
// (MacBook / "laptop" / "notebook" → 002 Laptop-MacBook, else 001 Desktop).
// Everything else is 000 (unspecified) and can be edited on the device.
func subCode(deviceType, model, osName string) string {
	if strings.ToLower(strings.TrimSpace(deviceType)) != "computer" {
		return "000"
	}
	h := strings.ToLower(model + " " + osName)
	if strings.Contains(h, "book") || strings.Contains(h, "laptop") || strings.Contains(h, "notebook") {
		return "002"
	}
	return "001"
}

// nextAssetSeq atomically returns and advances the per-(org, category) counter.
func nextAssetSeq(ctx context.Context, tx pgx.Tx, customerID, catCode string) (int, error) {
	var n int
	err := tx.QueryRow(ctx, `
		INSERT INTO assethub_asset_seq (customer_id, category_code, next_val)
		VALUES ($1, $2, 2)
		ON CONFLICT (customer_id, category_code)
		DO UPDATE SET next_val = assethub_asset_seq.next_val + 1
		RETURNING next_val - 1`, customerID, catCode).Scan(&n)
	return n, err
}

// generateAssetTag builds the next tag for a device and advances the counter.
func (h *Handler) generateAssetTag(ctx context.Context, tx pgx.Tx, customerID, deviceType, model, osName string) (string, error) {
	var prefix string
	if err := tx.QueryRow(ctx,
		`SELECT COALESCE(NULLIF(asset_tag_prefix, ''), 'F2') FROM customers WHERE id=$1`, customerID).
		Scan(&prefix); err != nil {
		prefix = "F2"
	}
	cc := catCode(deviceType)
	n, err := nextAssetSeq(ctx, tx, customerID, cc)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%s-%s-%s-%03d", prefix, cc, subCode(deviceType, model, osName), n), nil
}

// assignAssetTagIfEmpty sets a generated tag on a device only when it has none,
// so re-ingests and manual entries with an explicit tag are left untouched.
func (h *Handler) assignAssetTagIfEmpty(ctx context.Context, tx pgx.Tx, deviceID, customerID, deviceType, model, osName string) error {
	var existing string
	if err := tx.QueryRow(ctx, `SELECT COALESCE(asset_tag, '') FROM assethub_devices WHERE id=$1`, deviceID).Scan(&existing); err != nil {
		return err
	}
	if strings.TrimSpace(existing) != "" {
		return nil
	}
	tag, err := h.generateAssetTag(ctx, tx, customerID, deviceType, model, osName)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE assethub_devices SET asset_tag=$2 WHERE id=$1`, deviceID, tag)
	return err
}
