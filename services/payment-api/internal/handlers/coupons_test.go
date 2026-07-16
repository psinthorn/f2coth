package handlers

import (
	"testing"
	"time"
)

// prorateDelta: only upgrades charge, prorated by remaining cycle fraction.
func TestProrateDelta(t *testing.T) {
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	end := start.AddDate(0, 0, 30) // 30-day cycle
	mid := start.AddDate(0, 0, 15)  // half remaining

	cases := []struct {
		name              string
		old, neu          int64
		asOf              time.Time
		want              int64
	}{
		{"upgrade half-cycle", 100000, 200000, mid, 50000},
		{"upgrade full remaining", 100000, 200000, start, 100000},
		{"downgrade → no charge", 200000, 100000, mid, 0},
		{"same price → no charge", 100000, 100000, mid, 0},
		{"past cycle end → no charge", 100000, 200000, end.AddDate(0, 0, 1), 0},
	}
	for _, c := range cases {
		if got := prorateDelta(c.old, c.neu, start, end, c.asOf); got != c.want {
			t.Errorf("%s: prorateDelta = %d, want %d", c.name, got, c.want)
		}
	}
}
