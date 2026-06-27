package middleware

// modulegate — chi middleware that 404s requests when the corresponding
// modules-table row is disabled. Defense-in-depth behind the frontend
// gating in services/web-app/src/lib/modules.ts; ensures direct API
// callers (curl, scripts) honour the same toggles a user would see.
//
// COPY-PASTE WARNING: this file is duplicated verbatim in
// services/auth-api/internal/middleware/modulegate.go. When changing the
// shape, update both. When a 3rd service needs the same shape, extract
// to a shared module (pkg/modulegate with its own go.mod) before adding
// a third copy — per the reuse mandate in MEMORY.md.
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
	"time"
)

const (
	moduleCacheTTL     = 30 * time.Second
	moduleFetchTimeout = 3 * time.Second
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

// GateModule returns a chi-compatible middleware that 404s any request whose
// module key is disabled. Use sparingly — wrap whole route groups, not every
// handler, to keep the call graph readable.
func GateModule(moduleKey string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !globalModuleCache.isEnabled(moduleKey) {
				http.NotFound(w, r)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
