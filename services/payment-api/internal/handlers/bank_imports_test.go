package handlers

import (
	"strings"
	"testing"
)

func TestParseBankAmount(t *testing.T) {
	cases := []struct {
		in   string
		want int64
		err  bool
	}{
		{"1234.56", 123456, false},
		{"฿1,234.56", 123456, false},
		{"1,234.56 THB", 123456, false},
		{" 0.50 ", 50, false},
		{"", 0, true},
		{"not-a-number", 0, true},
	}
	for _, c := range cases {
		got, err := parseBankAmount(c.in)
		if c.err {
			if err == nil {
				t.Errorf("parseBankAmount(%q) = %d, want error", c.in, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("parseBankAmount(%q) error: %v", c.in, err)
			continue
		}
		if got != c.want {
			t.Errorf("parseBankAmount(%q) = %d, want %d", c.in, got, c.want)
		}
	}
}

func TestParseBankDate(t *testing.T) {
	formats := []string{
		"2026-03-15T08:30:00Z",
		"2026-03-15 08:30:00",
		"2026-03-15",
		"15/03/2026",
		"15/03/2026 08:30",
	}
	for _, s := range formats {
		if _, err := parseBankDate(s); err != nil {
			t.Errorf("parseBankDate(%q) failed: %v", s, err)
		}
	}
	if _, err := parseBankDate("nope"); err == nil {
		t.Errorf("parseBankDate(nope) should fail")
	}
}

func TestParseBankCSVHappyPath(t *testing.T) {
	csv := `transferred_at,amount_thb,bank_ref,description
2026-03-15,1234.56,KBANK-001,Invoice INV-2026-000001
2026-03-16T10:00:00Z,"800.00",KBANK-002,Hosting renewal
`
	rows, err := parseBankCSV(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("parseBankCSV: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("expected 2 rows, got %d", len(rows))
	}
	if rows[0].AmountCents != 123456 {
		t.Errorf("row 0 amount: %d", rows[0].AmountCents)
	}
	if rows[0].BankRef != "KBANK-001" {
		t.Errorf("row 0 bank_ref: %q", rows[0].BankRef)
	}
	if rows[1].AmountCents != 80000 {
		t.Errorf("row 1 amount: %d", rows[1].AmountCents)
	}
}

func TestParseBankCSVSkipsBadRows(t *testing.T) {
	// Two header columns and ragged rows — the second data row has a
	// blank amount and must be skipped without aborting the parse.
	csv := `transferred_at,amount_thb,bank_ref
2026-03-15,100.00,A
2026-03-16,,B
2026-03-17,300.00,C
`
	rows, err := parseBankCSV(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("parseBankCSV: %v", err)
	}
	if len(rows) != 2 {
		t.Errorf("expected 2 valid rows, got %d", len(rows))
	}
}

func TestParseBankCSVMissingRequiredColumn(t *testing.T) {
	csv := `date_only,bank_ref
2026-03-15,A
`
	if _, err := parseBankCSV(strings.NewReader(csv)); err == nil {
		t.Error("expected error for missing amount column")
	}
}

func TestParseBankCSVThaiHeaders(t *testing.T) {
	// Thai bank exports often have Thai headers — make sure the
	// header-alias map handles them.
	csv := `วันที่,จำนวน,อ้างอิง
2026-03-15,500.00,ABC
`
	rows, err := parseBankCSV(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("parseBankCSV: %v", err)
	}
	if len(rows) != 1 || rows[0].AmountCents != 50000 {
		t.Errorf("unexpected: %+v", rows)
	}
}
