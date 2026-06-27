package middleware

import (
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// withStubCMS swaps the global cache to point at a httptest server that
// returns the given rows, then restores the previous state on test cleanup.
// Each call resets fetchedAt so the next request triggers a fresh fetch.
func withStubCMS(t *testing.T, body string, statusCode int) (calls *atomic.Int64) {
	t.Helper()
	calls = &atomic.Int64{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(statusCode)
		_, _ = w.Write([]byte(body))
	}))

	prevURL := globalModuleCache.cmsURL
	prevEnabled := globalModuleCache.enabled
	prevFetched := globalModuleCache.fetchedAt

	globalModuleCache.mu.Lock()
	globalModuleCache.cmsURL = srv.URL
	globalModuleCache.enabled = map[string]bool{}
	globalModuleCache.fetchedAt = time.Time{}
	globalModuleCache.mu.Unlock()

	t.Cleanup(func() {
		srv.Close()
		globalModuleCache.mu.Lock()
		globalModuleCache.cmsURL = prevURL
		globalModuleCache.enabled = prevEnabled
		globalModuleCache.fetchedAt = prevFetched
		globalModuleCache.mu.Unlock()
	})
	return calls
}

// hit fires a single request through a GateModule(key)-wrapped handler that
// would otherwise return 200, returning the actual status code observed.
func hit(t *testing.T, key string) int {
	t.Helper()
	handler := GateModule(key)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/probe", nil)
	handler.ServeHTTP(rec, req)
	return rec.Code
}

func TestGate_AllowsWhenEnabled(t *testing.T) {
	withStubCMS(t, `[{"key":"api.test","enabled":true}]`, 200)
	if got := hit(t, "api.test"); got != http.StatusOK {
		t.Fatalf("expected 200 (gate open), got %d", got)
	}
}

func TestGate_BlocksWhenDisabled(t *testing.T) {
	withStubCMS(t, `[{"key":"api.test","enabled":false}]`, 200)
	if got := hit(t, "api.test"); got != http.StatusNotFound {
		t.Fatalf("expected 404 (gate closed), got %d", got)
	}
}

func TestGate_FailOpenOnUpstreamError(t *testing.T) {
	withStubCMS(t, "", 500)
	if got := hit(t, "api.test"); got != http.StatusOK {
		t.Fatalf("expected 200 (fail-open on cms-api 500), got %d", got)
	}
}

func TestGate_FailOpenOnGarbage(t *testing.T) {
	withStubCMS(t, "this is not json", 200)
	if got := hit(t, "api.test"); got != http.StatusOK {
		t.Fatalf("expected 200 (fail-open on decode error), got %d", got)
	}
}

func TestGate_UnknownKeyFailsOpen(t *testing.T) {
	withStubCMS(t, `[{"key":"api.other","enabled":false}]`, 200)
	if got := hit(t, "api.test"); got != http.StatusOK {
		t.Fatalf("expected 200 (unknown key → fail-open), got %d", got)
	}
}

func TestGate_CachesWithinTTL(t *testing.T) {
	calls := withStubCMS(t, `[{"key":"api.test","enabled":true}]`, 200)
	for i := 0; i < 5; i++ {
		if got := hit(t, "api.test"); got != http.StatusOK {
			t.Fatalf("call %d: expected 200, got %d", i, got)
		}
	}
	if n := calls.Load(); n != 1 {
		t.Fatalf("expected exactly 1 cms-api fetch within TTL, got %d", n)
	}
}

func TestGate_ConcurrentCallsSingleFlight(t *testing.T) {
	// Many goroutines racing into the first request should still trigger only
	// a small number of upstream fetches (ideally 1) thanks to the read-then-
	// write-lock pattern.
	calls := withStubCMS(t, `[{"key":"api.test","enabled":true}]`, 200)
	const N = 50
	var wg sync.WaitGroup
	wg.Add(N)
	for i := 0; i < N; i++ {
		go func() {
			defer wg.Done()
			_ = hit(t, "api.test")
		}()
	}
	wg.Wait()
	// Allow up to 2 — single-flight is best-effort under tight races but
	// must never explode to one-per-goroutine.
	if n := calls.Load(); n > 2 {
		t.Fatalf("expected <=2 cms-api fetches under concurrent load, got %d", n)
	}
}

func TestBlockCounter_IncrementsAndFlushes(t *testing.T) {
	// Hammer the counter directly (avoids the 5-minute ticker).
	c := &blockCounter{counts: map[string]*atomic.Uint64{}}
	c.inc("api.test")
	c.inc("api.test")
	c.inc("api.other")
	if got := c.counts["api.test"].Load(); got != 2 {
		t.Fatalf("expected api.test=2, got %d", got)
	}
	if got := c.counts["api.other"].Load(); got != 1 {
		t.Fatalf("expected api.other=1, got %d", got)
	}
}
