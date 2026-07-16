package handlers

// End-to-end integration test for the recurring-renewal engine (Phases
// 1–2), gated on TEST_DATABASE_URL. Unlike the lookup tests, these drive
// the real Scheduler passes against a live Postgres because the passes use
// the pool directly (not an injectable tx). Fixtures are seeded on the pool
// and torn down in FK-safe order in t.Cleanup.
//
// Notify points at an empty base URL so Send() is a no-op (no SMTP / HTTP);
// we assert on the DB side effects that prove the logic ran: generated
// invoices, invoice_items, and renewal_reminders idempotency stamps.

import (
	"context"
	"testing"
	"time"

	"github.com/f2cothai/f2-website/services/payment-api/internal/config"
	"github.com/f2cothai/f2-website/services/payment-api/internal/notify"
)

func newTestScheduler(t *testing.T) *Scheduler {
	t.Helper()
	pool := dbForTest(t) // skips when TEST_DATABASE_URL unset
	return &Scheduler{
		DB:     pool,
		Notify: notify.NewClient(""), // Send() no-ops on empty BaseURL
		Cfg: config.Config{
			BillingNotifyTo:            "billing@e2e.test",
			PortalBaseURL:              "http://portal.test",
			AdminBaseURL:               "http://admin.test",
			RenewalReminderOffsets:     []int{30, 14},
			DomainRenewalNoticeOffsets: []int{60, 30, 7},
			DomainRenewalInvoiceLead:   14,
			DomainPostExpiryNoticeDays: 1,
		},
		Tick:     time.Minute,
		LeadDays: 7,
	}
}

// seedCustomer creates a customer + owner contact and registers FK-safe
// cleanup. Returns the customer id.
func seedCustomer(t *testing.T, s *Scheduler) string {
	t.Helper()
	ctx := context.Background()
	slug := "e2e-" + time.Now().Format("20060102-150405.000000000")
	var cust string
	if err := s.DB.QueryRow(ctx, `
		INSERT INTO customers (slug, name, is_active) VALUES ($1,$2,true) RETURNING id::text`,
		slug, "E2E Renewal Customer").Scan(&cust); err != nil {
		t.Fatalf("seed customer: %v", err)
	}
	if _, err := s.DB.Exec(ctx, `
		INSERT INTO customer_contacts (customer_id, email, password_hash, full_name, role, locale)
		VALUES ($1,$2,$3,'E2E Owner','owner','en')`,
		cust, "owner-"+slug+"@e2e.test",
		"$2a$12$dummyhashfortestpurposesonlyxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"); err != nil {
		t.Fatalf("seed contact: %v", err)
	}
	t.Cleanup(func() {
		c := context.Background()
		s.DB.Exec(c, `DELETE FROM renewal_reminders WHERE entity_id IN (
			SELECT id FROM subscriptions WHERE customer_id=$1
			UNION SELECT id FROM customer_domains WHERE customer_id=$1)`, cust)
		s.DB.Exec(c, `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE customer_id=$1)`, cust)
		s.DB.Exec(c, `DELETE FROM invoices WHERE customer_id=$1`, cust)
		s.DB.Exec(c, `DELETE FROM subscriptions WHERE customer_id=$1`, cust)
		s.DB.Exec(c, `DELETE FROM customer_domains WHERE customer_id=$1`, cust)
		s.DB.Exec(c, `DELETE FROM customer_contacts WHERE customer_id=$1`, cust)
		s.DB.Exec(c, `DELETE FROM customers WHERE id=$1`, cust)
	})
	return cust
}

func offsetsFor(t *testing.T, s *Scheduler, entityType, entityID string) map[int]bool {
	t.Helper()
	rows, err := s.DB.Query(context.Background(),
		`SELECT offset_days FROM renewal_reminders WHERE entity_type=$1 AND entity_id=$2`,
		entityType, entityID)
	if err != nil {
		t.Fatalf("query offsets: %v", err)
	}
	defer rows.Close()
	out := map[int]bool{}
	for rows.Next() {
		var o int
		if err := rows.Scan(&o); err != nil {
			t.Fatal(err)
		}
		out[o] = true
	}
	return out
}

// ── Phase 1: subscription advance reminders ──────────────────────────

func TestE2E_SubscriptionAdvanceReminder(t *testing.T) {
	s := newTestScheduler(t)
	cust := seedCustomer(t, s)
	ctx := context.Background()

	var subID string
	if err := s.DB.QueryRow(ctx, `
		INSERT INTO subscriptions
		  (customer_id, title, product_type, billing_cycle, amount_cents, currency,
		   status, starts_on, next_billing_at)
		VALUES ($1,'E2E Hosting Plan','hosting','annually',120000,'THB','active',
		        CURRENT_DATE, CURRENT_DATE + INTERVAL '12 days')
		RETURNING id::text`, cust).Scan(&subID); err != nil {
		t.Fatalf("seed subscription: %v", err)
	}

	n, err := s.dispatchRenewalReminders(ctx)
	if err != nil {
		t.Fatalf("dispatchRenewalReminders: %v", err)
	}
	if n < 1 {
		t.Fatalf("expected >=1 reminder acted, got %d", n)
	}

	got := offsetsFor(t, s, "subscription", subID)
	// daysUntil=12 → chosen tier 14 (smallest open >=12); 30 superseded; 0=internal.
	for _, want := range []int{14, 30, 0} {
		if !got[want] {
			t.Errorf("missing renewal_reminders stamp offset=%d (have %v)", want, got)
		}
	}

	// Idempotency: a second run must not add new customer-tier stamps.
	before := len(got)
	if _, err := s.dispatchRenewalReminders(ctx); err != nil {
		t.Fatalf("2nd run: %v", err)
	}
	if after := len(offsetsFor(t, s, "subscription", subID)); after != before {
		t.Errorf("idempotency broken: offsets grew %d → %d", before, after)
	}
}

// ── Phase 1: subscription invoice generation ─────────────────────────

func TestE2E_SubscriptionInvoiceGeneration(t *testing.T) {
	s := newTestScheduler(t)
	cust := seedCustomer(t, s)
	ctx := context.Background()

	var subID string
	if err := s.DB.QueryRow(ctx, `
		INSERT INTO subscriptions
		  (customer_id, title, product_type, billing_cycle, amount_cents, currency,
		   status, starts_on, next_billing_at)
		VALUES ($1,'E2E Due Soon','hosting','annually',100000,'THB','active',
		        CURRENT_DATE, CURRENT_DATE + INTERVAL '3 days')
		RETURNING id::text`, cust).Scan(&subID); err != nil {
		t.Fatalf("seed subscription: %v", err)
	}

	n, err := s.generateSubscriptionInvoices(ctx)
	if err != nil {
		t.Fatalf("generateSubscriptionInvoices: %v", err)
	}
	if n < 1 {
		t.Fatalf("expected >=1 invoice generated, got %d", n)
	}

	var invCount, itemCount int
	s.DB.QueryRow(ctx, `SELECT count(*) FROM invoices WHERE subscription_id=$1`, subID).Scan(&invCount)
	s.DB.QueryRow(ctx, `
		SELECT count(*) FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id
		 WHERE i.subscription_id=$1 AND ii.product_type='hosting'`, subID).Scan(&itemCount)
	if invCount != 1 || itemCount != 1 {
		t.Errorf("want 1 invoice + 1 hosting item, got inv=%d item=%d", invCount, itemCount)
	}

	// next_billing_at advanced one year; last_billed_on stamped.
	var advanced bool
	s.DB.QueryRow(ctx, `
		SELECT next_billing_at = last_billed_on + INTERVAL '1 year' AND last_billed_on IS NOT NULL
		  FROM subscriptions WHERE id=$1`, subID).Scan(&advanced)
	if !advanced {
		t.Errorf("subscription next_billing_at not advanced by cycle")
	}
}

// ── Regression: weekly subscription must not double-bill ─────────────

func TestE2E_WeeklyNoDoubleBill(t *testing.T) {
	s := newTestScheduler(t)
	cust := seedCustomer(t, s)
	ctx := context.Background()

	var subID string
	if err := s.DB.QueryRow(ctx, `
		INSERT INTO subscriptions
		  (customer_id, title, product_type, billing_cycle, amount_cents, currency,
		   status, starts_on, next_billing_at)
		VALUES ($1,'E2E Weekly','custom','weekly',10000,'THB','active',
		        CURRENT_DATE, CURRENT_DATE)
		RETURNING id::text`, cust).Scan(&subID); err != nil {
		t.Fatalf("seed subscription: %v", err)
	}

	// Two ticks in a row (simulating the 5-min scheduler): a weekly sub sat
	// inside the 7-day lead window even after advancing +7d, so it used to
	// bill on every tick.
	if _, err := s.generateSubscriptionInvoices(ctx); err != nil {
		t.Fatalf("gen 1: %v", err)
	}
	if _, err := s.generateSubscriptionInvoices(ctx); err != nil {
		t.Fatalf("gen 2: %v", err)
	}

	var invCount int
	s.DB.QueryRow(ctx, `SELECT count(*) FROM invoices WHERE subscription_id=$1`, subID).Scan(&invCount)
	if invCount != 1 {
		t.Errorf("weekly sub billed %d times across two ticks, want exactly 1", invCount)
	}
}

// ── Regression: fixed coupon in another currency must not apply ──────

func TestE2E_CouponCurrencyMismatch(t *testing.T) {
	s := newTestScheduler(t)
	cust := seedCustomer(t, s)
	ctx := context.Background()

	code := "THB500-" + time.Now().Format("150405.000000")
	if _, err := s.DB.Exec(ctx, `
		INSERT INTO coupons (code, discount_type, discount_value, currency, applies_to)
		VALUES ($1,'fixed',500,'THB','all')`, code); err != nil {
		t.Fatalf("seed coupon: %v", err)
	}
	t.Cleanup(func() {
		s.DB.Exec(context.Background(), `DELETE FROM coupon_redemptions WHERE coupon_id IN (SELECT id FROM coupons WHERE code=$1)`, code)
		s.DB.Exec(context.Background(), `DELETE FROM coupons WHERE code=$1`, code)
	})

	// USD subscription — a THB fixed coupon must be ignored (no FX), not
	// subtract 500 USD-cents-at-THB-magnitude.
	var subID string
	if err := s.DB.QueryRow(ctx, `
		INSERT INTO subscriptions
		  (customer_id, title, product_type, billing_cycle, amount_cents, currency,
		   status, starts_on, next_billing_at, coupon_code)
		VALUES ($1,'E2E USD','custom','annually',2000,'USD','active',
		        CURRENT_DATE, CURRENT_DATE + INTERVAL '3 days', $2)
		RETURNING id::text`, cust, code).Scan(&subID); err != nil {
		t.Fatalf("seed subscription: %v", err)
	}

	if _, err := s.generateSubscriptionInvoices(ctx); err != nil {
		t.Fatalf("generate: %v", err)
	}
	var subtotal int64
	s.DB.QueryRow(ctx, `SELECT subtotal_cents FROM invoices WHERE subscription_id=$1`, subID).Scan(&subtotal)
	if subtotal != 2000 {
		t.Errorf("THB coupon wrongly applied to USD invoice: subtotal=%d, want 2000 (no discount)", subtotal)
	}
}

// ── Regression: recurring coupon keeps discount without re-consuming cap ─

func TestE2E_CouponRecurringCap(t *testing.T) {
	s := newTestScheduler(t)
	cust := seedCustomer(t, s)
	ctx := context.Background()

	code := "CAP1-" + time.Now().Format("150405.000000")
	if _, err := s.DB.Exec(ctx, `
		INSERT INTO coupons (code, discount_type, discount_value, applies_to, max_redemptions)
		VALUES ($1,'percent',10,'all',1)`, code); err != nil {
		t.Fatalf("seed coupon: %v", err)
	}
	t.Cleanup(func() {
		s.DB.Exec(context.Background(), `DELETE FROM coupon_redemptions WHERE coupon_id IN (SELECT id FROM coupons WHERE code=$1)`, code)
		s.DB.Exec(context.Background(), `DELETE FROM coupons WHERE code=$1`, code)
	})

	var subID string
	if err := s.DB.QueryRow(ctx, `
		INSERT INTO subscriptions
		  (customer_id, title, product_type, billing_cycle, amount_cents, currency,
		   status, starts_on, next_billing_at, coupon_code)
		VALUES ($1,'E2E Monthly','custom','monthly',100000,'THB','active',
		        CURRENT_DATE, CURRENT_DATE, $2)
		RETURNING id::text`, cust, code).Scan(&subID); err != nil {
		t.Fatalf("seed subscription: %v", err)
	}

	// Cycle 1.
	if _, err := s.generateSubscriptionInvoices(ctx); err != nil {
		t.Fatalf("gen 1: %v", err)
	}
	// Force a second cycle to become due.
	if _, err := s.DB.Exec(ctx, `UPDATE subscriptions SET next_billing_at=CURRENT_DATE, last_billed_on=NULL WHERE id=$1`, subID); err != nil {
		t.Fatalf("reset: %v", err)
	}
	if _, err := s.generateSubscriptionInvoices(ctx); err != nil {
		t.Fatalf("gen 2: %v", err)
	}

	// Both invoices discounted (90000); the max_redemptions=1 cap counts the
	// subscription once, not per invoice.
	var discountedInvoices, redCount int
	s.DB.QueryRow(ctx, `SELECT count(*) FROM invoices WHERE subscription_id=$1 AND subtotal_cents=90000`, subID).Scan(&discountedInvoices)
	s.DB.QueryRow(ctx, `SELECT redemption_count FROM coupons WHERE code=$1`, code).Scan(&redCount)
	if discountedInvoices != 2 {
		t.Errorf("recurring discount lost: %d of 2 invoices discounted", discountedInvoices)
	}
	if redCount != 1 {
		t.Errorf("cap consumed per-invoice: redemption_count=%d, want 1", redCount)
	}
}

// ── Coupons + custom cycle on subscription invoicing ─────────────────

func TestE2E_CouponAndCustomCycle(t *testing.T) {
	s := newTestScheduler(t)
	cust := seedCustomer(t, s)
	ctx := context.Background()

	// 10% off, applies to all.
	code := "E2E10-" + time.Now().Format("150405.000000")
	if _, err := s.DB.Exec(ctx, `
		INSERT INTO coupons (code, discount_type, discount_value, applies_to)
		VALUES ($1,'percent',10,'all')`, code); err != nil {
		t.Fatalf("seed coupon: %v", err)
	}
	t.Cleanup(func() {
		s.DB.Exec(context.Background(), `DELETE FROM coupon_redemptions WHERE coupon_id IN (SELECT id FROM coupons WHERE code=$1)`, code)
		s.DB.Exec(context.Background(), `DELETE FROM coupons WHERE code=$1`, code)
	})

	// Biennial subscription, 1000 THB, due in 3 days, with the coupon.
	var subID string
	if err := s.DB.QueryRow(ctx, `
		INSERT INTO subscriptions
		  (customer_id, title, product_type, billing_cycle, amount_cents, currency,
		   status, starts_on, next_billing_at, coupon_code)
		VALUES ($1,'E2E Biennial','hosting','biennially',100000,'THB','active',
		        CURRENT_DATE, CURRENT_DATE + INTERVAL '3 days', $2)
		RETURNING id::text`, cust, code).Scan(&subID); err != nil {
		t.Fatalf("seed subscription: %v", err)
	}

	if _, err := s.generateSubscriptionInvoices(ctx); err != nil {
		t.Fatalf("generateSubscriptionInvoices: %v", err)
	}

	// Subtotal discounted 10%: 100000 → 90000.
	var subtotal int64
	if err := s.DB.QueryRow(ctx,
		`SELECT subtotal_cents FROM invoices WHERE subscription_id=$1`, subID).Scan(&subtotal); err != nil {
		t.Fatalf("query invoice: %v", err)
	}
	if subtotal != 90000 {
		t.Errorf("coupon not applied: subtotal=%d, want 90000", subtotal)
	}

	// Redemption recorded + counter bumped.
	var redCount, disc int64
	s.DB.QueryRow(ctx, `SELECT redemption_count FROM coupons WHERE code=$1`, code).Scan(&redCount)
	s.DB.QueryRow(ctx, `SELECT discount_cents FROM coupon_redemptions cr JOIN coupons c ON c.id=cr.coupon_id WHERE c.code=$1`, code).Scan(&disc)
	if redCount != 1 || disc != 10000 {
		t.Errorf("redemption tracking off: count=%d discount=%d (want 1, 10000)", redCount, disc)
	}

	// Biennial cycle advanced next_billing_at by 2 years.
	var advanced bool
	s.DB.QueryRow(ctx, `
		SELECT next_billing_at = last_billed_on + INTERVAL '2 years'
		  FROM subscriptions WHERE id=$1`, subID).Scan(&advanced)
	if !advanced {
		t.Errorf("biennial cycle not advanced by 2 years")
	}
}

// ── Phase 2: domain renewal (notice + auto-invoice) ──────────────────

func TestE2E_DomainRenewalUpcoming(t *testing.T) {
	s := newTestScheduler(t)
	cust := seedCustomer(t, s)
	ctx := context.Background()

	// Unique TLD so we don't collide with seeded domain_pricing.
	if _, err := s.DB.Exec(ctx, `
		INSERT INTO domain_pricing (tld, registry, register_price_thb, renew_price_thb, transfer_price_thb, is_active)
		VALUES ('e2e','resellerclub',600,500,400,true)
		ON CONFLICT (tld) DO UPDATE SET renew_price_thb=500, is_active=true`); err != nil {
		t.Fatalf("seed domain_pricing: %v", err)
	}
	t.Cleanup(func() { s.DB.Exec(context.Background(), `DELETE FROM domain_pricing WHERE tld='e2e'`) })

	var domID string
	if err := s.DB.QueryRow(ctx, `
		INSERT INTO customer_domains (customer_id, domain, registrar, expires_at, auto_renew)
		VALUES ($1,'renew-me.e2e','ResellerClub', NOW() + INTERVAL '5 days', true)
		RETURNING id::text`, cust).Scan(&domID); err != nil {
		t.Fatalf("seed domain: %v", err)
	}

	if _, err := s.dispatchDomainRenewals(ctx); err != nil {
		t.Fatalf("dispatchDomainRenewals: %v", err)
	}

	got := offsetsFor(t, s, "domain", domID)
	// daysUntil=5 → notice tier 7 chosen (smallest >=5), 30/60 superseded,
	// 0=internal, -1=invoiced. (-2 not set: not yet expired.)
	for _, want := range []int{7, 30, 60, 0, domainStampInvoiced} {
		if !got[want] {
			t.Errorf("missing domain stamp offset=%d (have %v)", want, got)
		}
	}
	if got[domainStampExpired] {
		t.Errorf("post-expiry stamp set for a not-yet-expired domain")
	}

	// A renewal invoice priced from domain_pricing (500 THB = 50000 satang).
	var unit int64
	var ptype string
	if err := s.DB.QueryRow(ctx, `
		SELECT ii.unit_price_cents, ii.product_type
		  FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id
		 WHERE i.customer_id=$1 AND ii.product_type='domain' LIMIT 1`, cust).Scan(&unit, &ptype); err != nil {
		t.Fatalf("expected a domain renewal invoice item: %v", err)
	}
	if unit != 50000 {
		t.Errorf("domain renewal unit price = %d satang, want 50000 (500 THB)", unit)
	}
}

// ── Grace/redemption: compounded recovery fees on a lapsed domain ────

func TestE2E_DomainRedemptionFees(t *testing.T) {
	s := newTestScheduler(t)
	s.Cfg.DomainMaxRecoveryDays = 45
	cust := seedCustomer(t, s)
	ctx := context.Background()

	// renew 500, grace 10d @100, redemption 30d @2000.
	if _, err := s.DB.Exec(ctx, `
		INSERT INTO domain_pricing
		  (tld, registry, register_price_thb, renew_price_thb, transfer_price_thb,
		   grace_period_days, redemption_period_days, grace_fee_thb, redemption_fee_thb, is_active)
		VALUES ('lapse','resellerclub',600,500,400,10,30,100,2000,true)
		ON CONFLICT (tld) DO UPDATE SET renew_price_thb=500, grace_period_days=10,
		   redemption_period_days=30, grace_fee_thb=100, redemption_fee_thb=2000, is_active=true`); err != nil {
		t.Fatalf("seed pricing: %v", err)
	}
	t.Cleanup(func() { s.DB.Exec(context.Background(), `DELETE FROM domain_pricing WHERE tld='lapse'`) })

	// Expired 20 days ago → past 10-day grace, inside redemption window.
	if _, err := s.DB.Exec(ctx, `
		INSERT INTO customer_domains (customer_id, domain, registrar, expires_at, auto_renew)
		VALUES ($1,'recover.lapse','ResellerClub', NOW() - INTERVAL '20 days', true)`, cust); err != nil {
		t.Fatalf("seed domain: %v", err)
	}

	if _, err := s.dispatchDomainRenewals(ctx); err != nil {
		t.Fatalf("dispatchDomainRenewals: %v", err)
	}

	// Expect three line items: renewal 50000 + grace 10000 + redemption 200000.
	var got []int64
	rows, err := s.DB.Query(ctx, `
		SELECT ii.unit_price_cents
		  FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id
		 WHERE i.customer_id=$1 AND ii.product_type='domain'
		 ORDER BY ii.sort_order`, cust)
	if err != nil {
		t.Fatalf("query items: %v", err)
	}
	for rows.Next() {
		var c int64
		rows.Scan(&c)
		got = append(got, c)
	}
	rows.Close()
	want := []int64{50000, 10000, 200000}
	if len(got) != 3 {
		t.Fatalf("want 3 line items (renew+grace+redemption), got %d: %v", len(got), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("line %d = %d satang, want %d", i, got[i], want[i])
		}
	}
}

// ── Phase 2: domain expired (post-expiry notice) ─────────────────────

func TestE2E_DomainExpiredNotice(t *testing.T) {
	s := newTestScheduler(t)
	cust := seedCustomer(t, s)
	ctx := context.Background()

	var domID string
	if err := s.DB.QueryRow(ctx, `
		INSERT INTO customer_domains (customer_id, domain, registrar, expires_at, auto_renew)
		VALUES ($1,'lapsed.e2e','ResellerClub', NOW() - INTERVAL '2 days', true)
		RETURNING id::text`, cust).Scan(&domID); err != nil {
		t.Fatalf("seed domain: %v", err)
	}

	if _, err := s.dispatchDomainRenewals(ctx); err != nil {
		t.Fatalf("dispatchDomainRenewals: %v", err)
	}

	got := offsetsFor(t, s, "domain", domID)
	// daysUntil=-2 → post-expiry notice (-2 stamp) fires; no before-notices.
	if !got[domainStampExpired] {
		t.Errorf("expected post-expiry stamp (%d), have %v", domainStampExpired, got)
	}
	for _, unexpected := range []int{7, 30, 60} {
		if got[unexpected] {
			t.Errorf("before-expiry tier %d set for an already-expired domain", unexpected)
		}
	}
}
