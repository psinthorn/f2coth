package handlers

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/f2cothai/f2-website/services/payment-api/internal/paypal"
)

// Per-method mode lookup with a small in-process cache. Each payment
// method (bank_transfer, thai_qr, promptpay, paypal) carries its own
// 'sandbox' | 'production' setting in payment_methods_config.mode —
// admins toggle them independently from /admin/payment-methods.
//
// The cache keeps the hot path (every PortalInit, every SandboxBanner
// status check, every PayPal API call) from hitting Postgres. TTL is
// short so an admin toggle propagates across the cluster within a few
// seconds without a restart.

const methodModeCacheTTL = 5 * time.Second

type methodModeSnapshot struct {
	modes map[string]string // method → "sandbox"|"production"
	at    time.Time
}

type methodModeCache struct {
	mu   sync.RWMutex
	snap *methodModeSnapshot
}

var globalMethodModeCache = &methodModeCache{}

// loadAll refreshes the snapshot from DB. Returns the populated map or
// nil on error (callers fall back to 'sandbox' — the safer default).
func (c *methodModeCache) loadAll(ctx context.Context, db *pgxpool.Pool) map[string]string {
	rows, err := db.Query(ctx, `SELECT method, mode FROM payment_methods_config`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var method, mode string
		if err := rows.Scan(&method, &mode); err != nil {
			return nil
		}
		out[method] = mode
	}
	c.mu.Lock()
	c.snap = &methodModeSnapshot{modes: out, at: time.Now()}
	c.mu.Unlock()
	return out
}

func (c *methodModeCache) get(ctx context.Context, db *pgxpool.Pool) map[string]string {
	c.mu.RLock()
	fresh := c.snap != nil && time.Since(c.snap.at) < methodModeCacheTTL
	if fresh {
		out := c.snap.modes
		c.mu.RUnlock()
		return out
	}
	c.mu.RUnlock()
	if m := c.loadAll(ctx, db); m != nil {
		return m
	}
	// Read failed — return the previous (possibly stale) snapshot rather
	// than crash. If we have no prior snapshot, return nil so callers
	// fall back to 'sandbox'.
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.snap != nil {
		return c.snap.modes
	}
	return nil
}

// GetMethodMode returns the active mode for one method. Defaults to
// 'sandbox' on missing/error — fail-safe so we never accidentally hit
// live PayPal because the DB blinked.
func GetMethodMode(ctx context.Context, db *pgxpool.Pool, method string) string {
	modes := globalMethodModeCache.get(ctx, db)
	if mode, ok := modes[method]; ok && mode != "" {
		return mode
	}
	return "sandbox"
}

// GetAllMethodModes returns the full method → mode map plus a flag
// indicating whether any method is in sandbox (drives the global
// SandboxBanner).
func GetAllMethodModes(ctx context.Context, db *pgxpool.Pool) (map[string]string, bool) {
	modes := globalMethodModeCache.get(ctx, db)
	if modes == nil {
		return map[string]string{}, true // unknown → assume sandbox to be safe
	}
	anySandbox := false
	out := make(map[string]string, len(modes))
	for k, v := range modes {
		out[k] = v
		if v == "sandbox" {
			anySandbox = true
		}
	}
	return out, anySandbox
}

// invalidateMethodModeCache forces the next call to re-read from DB.
// Methods handler calls this after every PUT so a toggle takes effect
// immediately within the process.
func invalidateMethodModeCache() {
	globalMethodModeCache.mu.Lock()
	defer globalMethodModeCache.mu.Unlock()
	globalMethodModeCache.snap = nil
}

// ---------- PayPal credentials cache (per-env) ----------
//
// Credentials live in payment_methods_config.config under the
// {sandbox: {...}, live: {...}} keys. We read them through a tiny cache
// so the PayPal client doesn't hit Postgres for every API call.
// Methods handler invalidates the cache on every PUT.

const paypalCredsCacheTTL = 5 * time.Second

type paypalCredsSnapshot struct {
	sandbox paypal.CredSet
	live    paypal.CredSet
	at      time.Time
}

type paypalCredsCache struct {
	mu   sync.RWMutex
	snap *paypalCredsSnapshot
}

var globalPayPalCredsCache = &paypalCredsCache{}

func (c *paypalCredsCache) load(ctx context.Context, db *pgxpool.Pool) *paypalCredsSnapshot {
	var cfg json.RawMessage
	if err := db.QueryRow(ctx,
		`SELECT config FROM payment_methods_config WHERE method='paypal'`).
		Scan(&cfg); err != nil {
		return nil
	}
	var parsed struct {
		Sandbox struct {
			ClientID     string `json:"client_id"`
			ClientSecret string `json:"client_secret"`
			WebhookID    string `json:"webhook_id"`
		} `json:"sandbox"`
		Live struct {
			ClientID     string `json:"client_id"`
			ClientSecret string `json:"client_secret"`
			WebhookID    string `json:"webhook_id"`
		} `json:"live"`
	}
	if err := json.Unmarshal(cfg, &parsed); err != nil {
		return nil
	}
	snap := &paypalCredsSnapshot{
		sandbox: paypal.CredSet{
			ClientID:     parsed.Sandbox.ClientID,
			ClientSecret: parsed.Sandbox.ClientSecret,
			WebhookID:    parsed.Sandbox.WebhookID,
		},
		live: paypal.CredSet{
			ClientID:     parsed.Live.ClientID,
			ClientSecret: parsed.Live.ClientSecret,
			WebhookID:    parsed.Live.WebhookID,
		},
		at: time.Now(),
	}
	c.mu.Lock()
	c.snap = snap
	c.mu.Unlock()
	return snap
}

// GetPayPalCreds returns the cached credential set for the given
// environment. The PayPal client wires its `getCreds` callback to this
// helper so credentials are sourced from the DB and admins can edit
// them from /admin/payment-methods without restarting.
func GetPayPalCreds(ctx context.Context, db *pgxpool.Pool, env paypal.Environment) paypal.CredSet {
	c := globalPayPalCredsCache
	c.mu.RLock()
	fresh := c.snap != nil && time.Since(c.snap.at) < paypalCredsCacheTTL
	if fresh {
		s := c.snap
		c.mu.RUnlock()
		if env == paypal.Live {
			return s.live
		}
		return s.sandbox
	}
	c.mu.RUnlock()
	if s := c.load(ctx, db); s != nil {
		if env == paypal.Live {
			return s.live
		}
		return s.sandbox
	}
	// Stale fallback so a transient DB blip doesn't break in-flight calls.
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.snap != nil {
		if env == paypal.Live {
			return c.snap.live
		}
		return c.snap.sandbox
	}
	return paypal.CredSet{}
}

// invalidatePayPalCredsCache is called from methods handler after a
// successful PUT on the paypal row.
func invalidatePayPalCredsCache() {
	globalPayPalCredsCache.mu.Lock()
	defer globalPayPalCredsCache.mu.Unlock()
	globalPayPalCredsCache.snap = nil
}
