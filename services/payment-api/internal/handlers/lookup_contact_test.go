package handlers

// Tests for lookupBillingContact — the shared recipient-resolver used by
// scheduler.go (dunning, suspension), payments.go, webhooks.go, and
// invoices.go. Split across two layers:
//
//   1. TestContactLookupSQL_* — string-level regression guards on the
//      contactLookupSQL constant. Run on every `go test ./...` without a
//      database. Catches the exact class of bug that shipped for months
//      unnoticed: an inline JOIN on a column (customer_contacts.is_primary)
//      that never existed, which made the whole query error and every
//      dunning/receipt email silently drop to /dev/null.
//
//   2. TestLookupBillingContact_Resolution* — real Postgres integration
//      tests, gated on TEST_DATABASE_URL. Each test runs in a transaction
//      that gets rolled back at the end, so nothing persists. Verifies the
//      three-tier resolution order (billing profile → owner contact →
//      any active contact → "" when nothing).

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ─────────────────────────────────────────────────────────────────
// 1. Regression: SQL never references phantom columns
// ─────────────────────────────────────────────────────────────────

// The historical bug was `JOIN customer_contacts cc ON cc.is_primary = true`.
// No such column ever existed in migration 009. This test locks in the fix.
func TestContactLookupSQL_DoesNotReferenceIsPrimary(t *testing.T) {
	if strings.Contains(contactLookupSQL, "is_primary") {
		t.Fatal("contactLookupSQL references is_primary — this column does not exist on customer_contacts (migration 009). The schema models the account owner as role='owner'. See scheduler_test.go for context.")
	}
}

func TestContactLookupSQL_SelectsFromCanonicalTables(t *testing.T) {
	// Positive checks — if the query gets rewritten, it must still hit
	// the right tables + role filter. Cheap and catches obvious regressions.
	for _, needle := range []string{
		"customer_billing_profiles",
		"customer_contacts",
		"role='owner'",
		"disabled_at IS NULL",
	} {
		if !strings.Contains(contactLookupSQL, needle) {
			t.Errorf("contactLookupSQL missing expected clause %q — likely regressed the resolution order", needle)
		}
	}
}

// ─────────────────────────────────────────────────────────────────
// 2. Integration: real Postgres, tx-rollback per test
// ─────────────────────────────────────────────────────────────────

// dbForTest opens a pool against TEST_DATABASE_URL. Skips the test when
// the env var is unset so `go test ./...` still passes on a bare machine
// (developer laptop, CI without a DB service, etc).
func dbForTest(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping integration test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// txForTest starts a transaction and registers a rollback for teardown.
// Every fixture INSERT below runs in this tx so nothing leaks into the DB
// after the test finishes — even a failing test cleans up.
func txForTest(t *testing.T, pool *pgxpool.Pool) pgx.Tx {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	t.Cleanup(func() {
		_ = tx.Rollback(context.Background())
	})
	return tx
}

// insertTestCustomer creates a customers row inside the caller's tx and
// returns the new id. The slug is randomised via now-ns so parallel test
// runs don't collide on the unique slug constraint.
func insertTestCustomer(t *testing.T, tx pgx.Tx, name string) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	slug := "test-" + time.Now().Format("20060102-150405.000000000")
	var id string
	err := tx.QueryRow(ctx, `
		INSERT INTO customers (slug, name, is_active)
		VALUES ($1, $2, true)
		RETURNING id::text`,
		slug, name,
	).Scan(&id)
	if err != nil {
		t.Fatalf("insert customer: %v", err)
	}
	return id
}

// insertContact adds a customer_contacts row. bcrypt hash is a fixed
// dummy (this table's password_hash is NOT NULL but tests never log in).
func insertContact(t *testing.T, tx pgx.Tx, customerID, email, role, locale string, disabled bool) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var disabledAt any
	if disabled {
		disabledAt = time.Now()
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO customer_contacts (customer_id, email, password_hash, full_name, role, locale, disabled_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		customerID, email,
		"$2a$12$dummyhashfortestpurposesonlyxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
		"Test Contact "+role, role, locale, disabledAt,
	)
	if err != nil {
		t.Fatalf("insert contact: %v", err)
	}
}

// insertBillingProfile writes the billing profile with a specific email.
func insertBillingProfile(t *testing.T, tx pgx.Tx, customerID, billingEmail string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, err := tx.Exec(ctx, `
		INSERT INTO customer_billing_profiles
		    (customer_id, legal_name, branch_code, country, billing_email)
		VALUES ($1, 'Test Co Ltd', '00000', 'TH', $2)`,
		customerID, billingEmail,
	)
	if err != nil {
		t.Fatalf("insert billing profile: %v", err)
	}
}

// Each of the four resolution tests below constructs a customer with a
// specific combination of fixtures then asserts lookupBillingContact
// returns the right email + locale. Together they exhaust every branch
// in the switch.

func TestLookupBillingContact_ResolvesToBillingEmail(t *testing.T) {
	pool := dbForTest(t)
	tx := txForTest(t, pool)
	cust := insertTestCustomer(t, tx, "BillingProfile customer")
	insertBillingProfile(t, tx, cust, "billing@example.com")
	insertContact(t, tx, cust, "owner@example.com", "owner", "th", false)

	to, locale := lookupBillingContact(context.Background(), tx, cust)
	if to != "billing@example.com" {
		t.Errorf("to=%q, want billing@example.com (profile should win over owner)", to)
	}
	if locale != "th" {
		// Locale falls through to the owner's locale since billing profile has no locale column.
		t.Errorf("locale=%q, want th (from owner contact)", locale)
	}
}

func TestLookupBillingContact_FallsBackToOwnerContact(t *testing.T) {
	pool := dbForTest(t)
	tx := txForTest(t, pool)
	cust := insertTestCustomer(t, tx, "Owner-only customer")
	insertContact(t, tx, cust, "owner@example.com", "owner", "en", false)

	to, locale := lookupBillingContact(context.Background(), tx, cust)
	if to != "owner@example.com" {
		t.Errorf("to=%q, want owner@example.com", to)
	}
	if locale != "en" {
		t.Errorf("locale=%q, want en", locale)
	}
}

func TestLookupBillingContact_FallsBackToMemberContact(t *testing.T) {
	pool := dbForTest(t)
	tx := txForTest(t, pool)
	cust := insertTestCustomer(t, tx, "Member-only customer")
	insertContact(t, tx, cust, "member@example.com", "member", "th", false)

	to, locale := lookupBillingContact(context.Background(), tx, cust)
	if to != "member@example.com" {
		t.Errorf("to=%q, want member@example.com", to)
	}
	if locale != "th" {
		t.Errorf("locale=%q, want th", locale)
	}
}

func TestLookupBillingContact_ReturnsEmptyWhenNoContact(t *testing.T) {
	pool := dbForTest(t)
	tx := txForTest(t, pool)
	cust := insertTestCustomer(t, tx, "No-contact customer")

	to, locale := lookupBillingContact(context.Background(), tx, cust)
	if to != "" {
		t.Errorf("to=%q, want empty (no contact = do not spam)", to)
	}
	if locale != "en" {
		t.Errorf("locale=%q, want en (default)", locale)
	}
}

// SkipsDisabledOwner — proves disabled_at IS NULL filter works: a
// disabled owner must NOT be picked, and if no other option exists we
// fall back to empty.
func TestLookupBillingContact_SkipsDisabledOwner(t *testing.T) {
	pool := dbForTest(t)
	tx := txForTest(t, pool)
	cust := insertTestCustomer(t, tx, "Disabled-owner customer")
	insertContact(t, tx, cust, "disabled-owner@example.com", "owner", "en", true) // disabled

	to, _ := lookupBillingContact(context.Background(), tx, cust)
	if to != "" {
		t.Errorf("to=%q, want empty (disabled owner must be excluded)", to)
	}
}
