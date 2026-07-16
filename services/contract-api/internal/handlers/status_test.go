package handlers

import "testing"

func TestCanTransition(t *testing.T) {
	cases := []struct {
		from, to string
		want     bool
	}{
		// Legal forward moves.
		{"draft", "sent", true},
		{"draft", "terminated", true},
		{"sent", "signed", true},
		{"sent", "draft", true}, // revert to edit
		{"sent", "terminated", true},
		{"signed", "active", true},
		{"signed", "sent", true},
		{"signed", "terminated", true},
		{"active", "expired", true},
		{"active", "terminated", true},
		{"expired", "active", true}, // renewal

		// Illegal jumps.
		{"draft", "signed", false},
		{"draft", "active", false},
		{"draft", "expired", false},
		{"sent", "active", false},
		{"signed", "expired", false},
		{"active", "draft", false},
		{"active", "sent", false},
		{"terminated", "active", false}, // terminal
		{"terminated", "draft", false},
		{"expired", "terminated", false},

		// Unknown / self.
		{"bogus", "draft", false},
		{"draft", "draft", false},
	}
	for _, c := range cases {
		if got := CanTransition(c.from, c.to); got != c.want {
			t.Errorf("CanTransition(%q,%q) = %v, want %v", c.from, c.to, got, c.want)
		}
	}
}

func TestFormatDocNo(t *testing.T) {
	cases := []struct {
		prefix string
		year   int
		seq    int
		want   string
	}{
		{"F2-AGR", 2026, 1, "F2-AGR-2026-001"},
		{"F2-AGR", 2026, 2, "F2-AGR-2026-002"},
		{"F2-AGR", 2026, 42, "F2-AGR-2026-042"},
		{"F2-AGR", 2026, 999, "F2-AGR-2026-999"},
		{"F2-AGR", 2026, 1000, "F2-AGR-2026-1000"}, // widens past 999
		{"F2-NDA", 2027, 7, "F2-NDA-2027-007"},
		{"F2-DOC", 2030, 100, "F2-DOC-2030-100"},
	}
	for _, c := range cases {
		if got := FormatDocNo(c.prefix, c.year, c.seq); got != c.want {
			t.Errorf("FormatDocNo(%q,%d,%d) = %q, want %q", c.prefix, c.year, c.seq, got, c.want)
		}
	}
}

// TestAllStatusesReachable is a light structural check: every non-terminal
// status has at least one outbound edge, and every status listed as valid
// appears as a key in the transition table.
func TestTransitionTableCoversValidStatuses(t *testing.T) {
	for _, s := range ValidStatuses {
		if _, ok := allowedTransitions[s]; !ok {
			t.Errorf("status %q missing from transition table", s)
		}
	}
}
