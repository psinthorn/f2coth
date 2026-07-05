package handlers

import (
	"testing"
	"time"
)

// The date-window math is the brittle part — an off-by-one on the ISO
// week boundary would silently drop Sunday's visits from the weekly
// summary. Pin the boundaries.
func TestReportWindow(t *testing.T) {
	loc := time.UTC
	// Friday 2026-07-03 is our reference point (Today = 2026-07-03 per CLAUDE.md).
	fri := time.Date(2026, 7, 3, 14, 30, 0, 0, loc)
	sun := time.Date(2026, 7, 5, 8, 0, 0, 0, loc)
	mon := time.Date(2026, 7, 6, 8, 0, 0, 0, loc)

	tests := []struct {
		name     string
		rng      string
		date     string
		now      time.Time
		wantRng  string
		wantFrom string
		wantTo   string
	}{
		{"weekly from Friday", "weekly", "", fri, "weekly",
			"2026-06-29 00:00:00", "2026-07-05 23:59:59"},
		{"weekly from Sunday should still land in same week", "weekly", "", sun, "weekly",
			"2026-06-29 00:00:00", "2026-07-05 23:59:59"},
		{"weekly from Monday rolls into next week", "weekly", "", mon, "weekly",
			"2026-07-06 00:00:00", "2026-07-12 23:59:59"},
		{"monthly anchored mid-month", "monthly", "", fri, "monthly",
			"2026-07-01 00:00:00", "2026-07-31 23:59:59"},
		{"empty range falls back to weekly", "", "", fri, "weekly",
			"2026-06-29 00:00:00", "2026-07-05 23:59:59"},
		{"garbage range falls back to weekly", "garbage", "", fri, "weekly",
			"2026-06-29 00:00:00", "2026-07-05 23:59:59"},
		{"explicit date overrides now", "weekly", "2026-01-15", fri, "weekly",
			"2026-01-12 00:00:00", "2026-01-18 23:59:59"},
		{"bad date string falls back to now", "monthly", "not-a-date", fri, "monthly",
			"2026-07-01 00:00:00", "2026-07-31 23:59:59"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotRng, gotFrom, gotTo := reportWindow(tt.rng, tt.date, tt.now)
			if gotRng != tt.wantRng {
				t.Errorf("range: got %q, want %q", gotRng, tt.wantRng)
			}
			if got := gotFrom.Format("2006-01-02 15:04:05"); got != tt.wantFrom {
				t.Errorf("from: got %s, want %s", got, tt.wantFrom)
			}
			// Truncate the nanosecond-precise to-boundary to full-second for readability.
			if got := gotTo.Truncate(time.Second).Format("2006-01-02 15:04:05"); got != tt.wantTo {
				t.Errorf("to: got %s, want %s", got, tt.wantTo)
			}
		})
	}
}
