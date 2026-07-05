package handlers

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// nextInvoiceNumber returns INV-{YYYY}-{seq:06}. Sequences live in
// Postgres so two concurrent inserts cannot collide.
func nextInvoiceNumber(ctx context.Context, tx pgx.Tx) (string, error) {
	var n int64
	if err := tx.QueryRow(ctx, "SELECT nextval('invoice_number_seq')").Scan(&n); err != nil {
		return "", err
	}
	return fmt.Sprintf("INV-%d-%06d", time.Now().Year(), n), nil
}

func nextPaymentNumber(ctx context.Context, tx pgx.Tx) (string, error) {
	var n int64
	if err := tx.QueryRow(ctx, "SELECT nextval('payment_number_seq')").Scan(&n); err != nil {
		return "", err
	}
	return fmt.Sprintf("PAY-%d-%06d", time.Now().Year(), n), nil
}
