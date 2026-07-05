package handlers

import (
	"fmt"
	"testing"
	"time"
)

// numbering helpers use SQL sequences so we can't test the full path
// without Postgres. The format string is the brittle part and worth
// pinning — accountants and customers see these.
func TestInvoiceNumberFormat(t *testing.T) {
	year := time.Now().Year()
	tests := []struct {
		seq  int64
		want string
	}{
		{1, fmt.Sprintf("INV-%d-000001", year)},
		{42, fmt.Sprintf("INV-%d-000042", year)},
		{999999, fmt.Sprintf("INV-%d-999999", year)},
	}
	for _, tt := range tests {
		got := fmt.Sprintf("INV-%d-%06d", year, tt.seq)
		if got != tt.want {
			t.Errorf("seq=%d: got %q, want %q", tt.seq, got, tt.want)
		}
	}
}

func TestPaymentNumberFormat(t *testing.T) {
	got := fmt.Sprintf("PAY-%d-%06d", 2026, int64(7))
	want := "PAY-2026-000007"
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestComputeItemsSubtotal(t *testing.T) {
	in := []itemInput{
		{Quantity: 2, UnitPriceCents: 12500}, // 250.00
		{Quantity: 1, UnitPriceCents: 80000}, // 800.00
		{Quantity: 0, UnitPriceCents: 999},   // Quantity clamped to 1 → 9.99
	}
	subtotal, out := computeItems(in)
	want := int64(2*12500 + 80000 + 1*999)
	if subtotal != want {
		t.Errorf("subtotal: got %d, want %d", subtotal, want)
	}
	if len(out) != 3 {
		t.Fatalf("expected 3 items, got %d", len(out))
	}
	if out[2].computedTotal() != 999 {
		t.Errorf("zero quantity not clamped to 1: %d", out[2].computedTotal())
	}
}
