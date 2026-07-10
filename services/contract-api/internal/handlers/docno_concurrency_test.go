package handlers

import (
	"context"
	"os"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TestAllocateDocNoConcurrent verifies the acceptance criterion: doc numbers
// increment safely under concurrency (no dupes, no gaps). Requires a Postgres
// with migrations applied; skipped when TEST_DATABASE_URL is unset so `make
// test` stays hermetic in CI.
func TestAllocateDocNoConcurrent(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping DB concurrency test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	// Use a far-future year so we never collide with real data, and clean it.
	const year = 4242
	const prefix = "F2-TST"
	const n = 50
	if _, err := pool.Exec(ctx, `DELETE FROM contract_doc_seq WHERE year = $1`, year); err != nil {
		t.Fatalf("cleanup: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM contract_doc_seq WHERE year = $1`, year) })

	var (
		mu      sync.Mutex
		seen    = map[string]bool{}
		wg      sync.WaitGroup
		failErr error
	)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			tx, err := pool.Begin(ctx)
			if err != nil {
				mu.Lock()
				failErr = err
				mu.Unlock()
				return
			}
			defer tx.Rollback(ctx)
			docNo, err := allocateDocNo(ctx, tx, prefix, year)
			if err != nil {
				mu.Lock()
				failErr = err
				mu.Unlock()
				return
			}
			if err := tx.Commit(ctx); err != nil {
				mu.Lock()
				failErr = err
				mu.Unlock()
				return
			}
			mu.Lock()
			if seen[docNo] {
				failErr = &dupErr{docNo}
			}
			seen[docNo] = true
			mu.Unlock()
		}()
	}
	wg.Wait()
	if failErr != nil {
		t.Fatalf("concurrent allocation failed: %v", failErr)
	}
	if len(seen) != n {
		t.Fatalf("expected %d unique doc-nos, got %d", n, len(seen))
	}
	// Verify the sequence is gap-free 1..n.
	for i := 1; i <= n; i++ {
		want := FormatDocNo(prefix, year, i)
		if !seen[want] {
			t.Errorf("missing doc-no in sequence: %s", want)
		}
	}
}

type dupErr struct{ docNo string }

func (e *dupErr) Error() string { return "duplicate doc-no: " + e.docNo }
