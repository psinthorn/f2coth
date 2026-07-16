package middleware

// modulegate — chi middleware that 404s requests when the corresponding
// modules-table row is disabled. Defense-in-depth behind the frontend
// gating in services/web-app/src/lib/modules.ts; ensures direct API
// callers (curl, scripts) honour the same toggles a user would see.
//
// CANONICAL SOURCE. This file is the single source of truth for the
// module-gate middleware. Each Go service that uses it gets a copy
// dropped into its own `internal/middleware/modulegate.go` via
// `make sync-modulegate` (or `scripts/sync-modulegate.sh` directly).
// Edit this file, then run the sync — never edit the per-service
// copies directly. CI runs the same sync in --check mode to fail PRs
// that drift.
//
// Behaviour:
//   • 30-second in-memory cache (sync.RWMutex) so we don't hit cms-api
//     on every request.
//   • Fail-open: if cms-api is unreachable or returns garbage, allow the
//     request through. Toggle integrity is best-effort — frontend gating
//     is the user-facing source of truth.
//   • If the supplied moduleKey isn't in the cms-api response, allow the
//     request (mirrors the frontend's fail-open for unknown keys).

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"sync"
	"sync/atomic"
	"time"
)

const (
	moduleCacheTTL     = 30 * time.Second
	moduleFetchTimeout = 3 * time.Second
	// How often to flush per-key block counters to the log. Coarse-grained on
	// purpose — gate hits are administratively interesting, not request-rate
	// material, so a 5-minute heartbeat is plenty for visibility.
	blockMetricFlushInterval = 5 * time.Minute
)

type moduleRow struct {
	Key     string `json:"key"`
	Enabled bool   `json:"enabled"`
}

type moduleCache struct {
	mu        sync.RWMutex
	enabled   map[string]bool
	fetchedAt time.Time
	cmsURL    string
}

var globalModuleCache = &moduleCache{
	enabled: map[string]bool{},
	// CMS_API_URL is set in docker-compose; falls back to the internal hostname.
	cmsURL: getenv("CMS_API_URL", "http://cms-api:8001") + "/api/cms/modules",
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// isEnabled returns whether the given module key is currently enabled. Unknown
// keys and fetch failures both return true (fail-open).
func (c *moduleCache) isEnabled(key string) bool {
	c.mu.RLock()
	stale := time.Since(c.fetchedAt) > moduleCacheTTL
	if !stale {
		v, ok := c.enabled[key]
		c.mu.RUnlock()
		return !ok || v
	}
	c.mu.RUnlock()

	// Refresh under the write lock. Two requests racing here is fine — both
	// will hit cms-api but only the latest write wins, identical content.
	c.mu.Lock()
	defer c.mu.Unlock()
	if time.Since(c.fetchedAt) <= moduleCacheTTL {
		// Another goroutine refreshed while we were waiting.
		v, ok := c.enabled[key]
		return !ok || v
	}

	client := &http.Client{Timeout: moduleFetchTimeout}
	resp, err := client.Get(c.cmsURL)
	if err != nil {
		log.Printf("modulegate: fetch failed, failing open: %v", err)
		c.fetchedAt = time.Now() // throttle retries
		return true
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		log.Printf("modulegate: cms-api returned %d, failing open", resp.StatusCode)
		c.fetchedAt = time.Now()
		return true
	}
	var rows []moduleRow
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		log.Printf("modulegate: decode failed, failing open: %v", err)
		c.fetchedAt = time.Now()
		return true
	}
	fresh := make(map[string]bool, len(rows))
	for _, r := range rows {
		fresh[r.Key] = r.Enabled
	}
	c.enabled = fresh
	c.fetchedAt = time.Now()
	v, ok := fresh[key]
	return !ok || v
}

// blockCounter accumulates how many requests each gated module key has
// rejected since the last flush. Per-key sub-counters use atomic.Uint64 so
// the hot path stays lock-free.
type blockCounter struct {
	mu      sync.Mutex
	counts  map[string]*atomic.Uint64
	started bool
}

var globalBlockCounter = &blockCounter{counts: map[string]*atomic.Uint64{}}

func (b *blockCounter) inc(key string) {
	b.mu.Lock()
	c, ok := b.counts[key]
	if !ok {
		c = &atomic.Uint64{}
		b.counts[key] = c
	}
	started := b.started
	b.started = true
	b.mu.Unlock()
	c.Add(1)
	if !started {
		// Lazily kick off the flush goroutine on first ever block. Avoids
		// spinning a ticker in services that never reject a request.
		go b.flushLoop()
	}
}

func (b *blockCounter) flushLoop() {
	t := time.NewTicker(blockMetricFlushInterval)
	defer t.Stop()
	for range t.C {
		b.mu.Lock()
		out := make(map[string]uint64, len(b.counts))
		for k, c := range b.counts {
			n := c.Swap(0)
			if n > 0 {
				out[k] = n
			}
		}
		b.mu.Unlock()
		if len(out) > 0 {
			log.Printf("modulegate: blocked-in-last-%v %v", blockMetricFlushInterval, out)
		}
	}
}

// GateModule returns a chi-compatible middleware that 404s any request whose
// module key is disabled. Use sparingly — wrap whole route groups, not every
// handler, to keep the call graph readable.
func GateModule(moduleKey string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !globalModuleCache.isEnabled(moduleKey) {
				globalBlockCounter.inc(moduleKey)
				http.NotFound(w, r)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
