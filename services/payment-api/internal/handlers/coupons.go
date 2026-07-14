package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// evaluateCoupon validates a coupon code within a transaction (FOR UPDATE
// so the redemption cap is race-safe) and returns the coupon id plus the
// discount in cents to subtract from `amount`. An invalid, inactive,
// out-of-window, wrong-scope, wrong-currency, or exhausted coupon yields
// (…, 0, nil) — a silent no-discount, never an error, so a bad code never
// blocks billing.
//
//   currency  — the invoice currency; a `fixed` coupon only applies when it
//               matches the coupon's currency (no FX conversion).
//   bypassCap — true for a subscription already redeeming this coupon in a
//               prior cycle, so max_redemptions counts distinct
//               subscriptions rather than every recurring invoice.
func evaluateCoupon(ctx context.Context, tx pgx.Tx, code, scope, currency string, amount int64, bypassCap bool) (string, int64, error) {
	var id, dtype, appliesTo, couponCurrency string
	var value, redCount int
	var maxRed *int
	err := tx.QueryRow(ctx, `
		SELECT id, discount_type, discount_value, currency, applies_to, max_redemptions, redemption_count
		  FROM coupons
		 WHERE code = $1 AND is_active
		   AND (valid_from  IS NULL OR valid_from  <= CURRENT_DATE)
		   AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
		 FOR UPDATE`, code).Scan(&id, &dtype, &value, &couponCurrency, &appliesTo, &maxRed, &redCount)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", 0, nil
		}
		return "", 0, err
	}
	if appliesTo != "all" && appliesTo != scope {
		return "", 0, nil
	}
	if !bypassCap && maxRed != nil && redCount >= *maxRed {
		return "", 0, nil
	}

	var discount int64
	switch dtype {
	case "percent":
		discount = amount * int64(value) / 100
	case "fixed":
		if couponCurrency != currency {
			return id, 0, nil // fixed amount is currency-specific; no FX
		}
		discount = int64(value) * 100 // whole units → minor units
	}
	if discount > amount {
		discount = amount
	}
	if discount < 0 {
		discount = 0
	}
	return id, discount, nil
}

// recordCouponRedemption logs the redemption (with the subscription it
// applied to) and, when incrementCount is true, bumps the coupon counter —
// inside the invoice's transaction. Recurring re-applications record an
// audit row but don't re-consume the cap.
func recordCouponRedemption(ctx context.Context, tx pgx.Tx, couponID, invoiceID, customerID, subID string, discount int64, incrementCount bool) error {
	if _, err := tx.Exec(ctx, `
		INSERT INTO coupon_redemptions (coupon_id, invoice_id, customer_id, subscription_id, discount_cents)
		VALUES ($1,$2,$3,$4,$5)`, couponID, invoiceID, customerID, subID, discount); err != nil {
		return err
	}
	if !incrementCount {
		return nil
	}
	_, err := tx.Exec(ctx, `UPDATE coupons SET redemption_count = redemption_count + 1 WHERE id=$1`, couponID)
	return err
}

// prorateDelta returns the one-off charge (cents, >= 0) for a mid-cycle
// plan change. Only upgrades (new > old) charge, prorated by the fraction
// of the current cycle still remaining; downgrades return 0 (the lower
// price simply takes effect next cycle — no credit note needed).
func prorateDelta(oldAmount, newAmount int64, cycleStart, cycleEnd, asOf time.Time) int64 {
	if newAmount <= oldAmount {
		return 0
	}
	// Cycle hasn't started yet (future-dated or still in trial): the new
	// price simply applies when the cycle first bills — no mid-cycle charge.
	if asOf.Before(cycleStart) {
		return 0
	}
	totalDays := cycleEnd.Sub(cycleStart).Hours() / 24
	if totalDays <= 0 {
		return 0
	}
	remainingDays := cycleEnd.Sub(asOf).Hours() / 24
	if remainingDays <= 0 {
		return 0
	}
	if remainingDays > totalDays {
		remainingDays = totalDays
	}
	delta := float64(newAmount-oldAmount) * (remainingDays / totalDays)
	return int64(delta + 0.5)
}

// ── Coupon admin CRUD ────────────────────────────────────────────────

type CouponHandler struct {
	DB *pgxpool.Pool
}

type couponRow struct {
	ID              string  `json:"id"`
	Code            string  `json:"code"`
	Description     *string `json:"description,omitempty"`
	DiscountType    string  `json:"discount_type"`
	DiscountValue   int     `json:"discount_value"`
	Currency        string  `json:"currency"`
	AppliesTo       string  `json:"applies_to"`
	MaxRedemptions  *int    `json:"max_redemptions,omitempty"`
	RedemptionCount int     `json:"redemption_count"`
	ValidFrom       *string `json:"valid_from,omitempty"`
	ValidUntil      *string `json:"valid_until,omitempty"`
	IsActive        bool    `json:"is_active"`
}

func (h *CouponHandler) AdminList(w http.ResponseWriter, r *http.Request) {
	rows, err := h.DB.Query(r.Context(), `
		SELECT id, code, description, discount_type, discount_value, currency,
		       applies_to, max_redemptions, redemption_count,
		       to_char(valid_from,'YYYY-MM-DD'), to_char(valid_until,'YYYY-MM-DD'), is_active
		  FROM coupons ORDER BY created_at DESC LIMIT 200`)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer rows.Close()
	out := []couponRow{}
	for rows.Next() {
		var c couponRow
		if err := rows.Scan(&c.ID, &c.Code, &c.Description, &c.DiscountType, &c.DiscountValue,
			&c.Currency, &c.AppliesTo, &c.MaxRedemptions, &c.RedemptionCount,
			&c.ValidFrom, &c.ValidUntil, &c.IsActive); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		out = append(out, c)
	}
	writeJSON(w, 200, out)
}

type couponInput struct {
	Code           string  `json:"code"`
	Description    *string `json:"description"`
	DiscountType   string  `json:"discount_type"`
	DiscountValue  int     `json:"discount_value"`
	Currency       string  `json:"currency"`
	AppliesTo      string  `json:"applies_to"`
	MaxRedemptions *int    `json:"max_redemptions"`
	ValidFrom      *string `json:"valid_from"`
	ValidUntil     *string `json:"valid_until"`
}

func (h *CouponHandler) AdminCreate(w http.ResponseWriter, r *http.Request) {
	var in couponInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	if in.Code == "" || in.DiscountValue <= 0 ||
		(in.DiscountType != "percent" && in.DiscountType != "fixed") {
		writeErr(w, 400, "code, a positive discount_value, and discount_type percent|fixed are required")
		return
	}
	if in.DiscountType == "percent" && in.DiscountValue > 100 {
		writeErr(w, 400, "percent discount_value must be 1-100")
		return
	}
	if in.Currency == "" {
		in.Currency = "THB"
	}
	if in.AppliesTo == "" {
		in.AppliesTo = "all"
	}
	ctx, cancel := makeCtx()
	defer cancel()
	var id string
	err := h.DB.QueryRow(ctx, `
		INSERT INTO coupons (code, description, discount_type, discount_value, currency,
		                     applies_to, max_redemptions, valid_from, valid_until)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9::date)
		RETURNING id`,
		in.Code, in.Description, in.DiscountType, in.DiscountValue, in.Currency,
		in.AppliesTo, in.MaxRedemptions, in.ValidFrom, in.ValidUntil).Scan(&id)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 201, map[string]string{"id": id})
}

// AdminSetActive toggles a coupon on/off (soft retire — history in
// coupon_redemptions is preserved).
func (h *CouponHandler) AdminSetActive(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var body struct {
		IsActive bool `json:"is_active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	tag, err := h.DB.Exec(r.Context(), `UPDATE coupons SET is_active=$1 WHERE id=$2`, body.IsActive, id)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, 404, "coupon not found")
		return
	}
	writeJSON(w, 200, map[string]bool{"is_active": body.IsActive})
}
