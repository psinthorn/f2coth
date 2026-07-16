package handlers

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// ── Status state machine ──────────────────────────────────────────────
//
// Server-enforced lifecycle. Illegal jumps are rejected (409) so the status
// column can never reach a state the UI didn't drive it through.
//
//   draft ──generate signing──▶ sent ──upload signed scan──▶ signed
//     │                          │                              │
//     │                          └── revert ──▶ draft           ▼ confirm
//     └── cancel ──▶ terminated                              active
//                                                     │        │
//                       terminated ◀── cancel ────────┘        ▼ expire
//                                                          expired
//
// draft: editable merge data, watermarked generation only.
// sent:  signing version generated (no watermark), awaiting signature.
// signed: signed scan uploaded, awaiting activation.
// active: in force, effective/end dates set. Enqueues an iACC invoice draft.
// expired/terminated: end states.

var allowedTransitions = map[string]map[string]bool{
	"draft":      {"sent": true, "terminated": true},
	"sent":       {"signed": true, "draft": true, "terminated": true},
	"signed":     {"active": true, "sent": true, "terminated": true},
	"active":     {"expired": true, "terminated": true},
	"expired":    {"active": true}, // renewal can reactivate
	"terminated": {},               // terminal
}

// ValidStatuses lists every status the CHECK constraint permits.
var ValidStatuses = []string{"draft", "sent", "signed", "active", "expired", "terminated"}

// CanTransition reports whether from → to is a legal status change.
func CanTransition(from, to string) bool {
	next, ok := allowedTransitions[from]
	if !ok {
		return false
	}
	return next[to]
}

// ── Doc-no generation ─────────────────────────────────────────────────

// FormatDocNo builds a document number from a prefix, year and sequence, e.g.
// FormatDocNo("F2-AGR", 2026, 1) => "F2-AGR-2026-001". Zero-padded to 3 digits
// (widens automatically past 999).
func FormatDocNo(prefix string, year, seq int) string {
	return fmt.Sprintf("%s-%d-%03d", prefix, year, seq)
}

// allocateDocNo reserves the next sequence for the given year inside tx. The
// INSERT ... ON CONFLICT DO UPDATE takes a row lock on contract_doc_seq(year),
// so concurrent contract creates serialise and every doc-no is unique and
// gap-free within the year — the concurrency-safety guarantee.
func allocateDocNo(ctx context.Context, tx pgx.Tx, prefix string, year int) (string, error) {
	var seq int
	err := tx.QueryRow(ctx, `
		INSERT INTO contract_doc_seq (year, last_seq) VALUES ($1, 1)
		ON CONFLICT (year) DO UPDATE SET last_seq = contract_doc_seq.last_seq + 1
		RETURNING last_seq`, year).Scan(&seq)
	if err != nil {
		return "", err
	}
	return FormatDocNo(prefix, year, seq), nil
}

// recordStatusEvent appends a timeline row. Best-effort within the caller's tx.
func recordStatusEvent(ctx context.Context, tx pgx.Tx, contractID, from, to, note, changedBy string) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO contract_status_events (contract_id, from_status, to_status, note, changed_by)
		VALUES ($1, NULLIF($2,''), $3, NULLIF($4,''), NULLIF($5,'')::uuid)`,
		contractID, from, to, note, changedBy)
	return err
}

// currentYear is overridable in tests; production uses the wall clock.
var currentYear = func() int { return time.Now().Year() }
