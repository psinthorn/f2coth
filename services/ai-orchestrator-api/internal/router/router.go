// Package router picks the right provider + model for a task_type,
// invokes it, falls back on error, and hands the result to the usage
// logger. This is the single dispatch point every business feature uses.
//
// The routing table is polled every RoutingRefreshSeconds so admin
// changes in /admin/ai/routing take effect without a redeploy.
package router

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/f2cothai/f2-website/services/ai-orchestrator-api/internal/providers"
)

type Route struct {
	TaskType     string
	Tier         string
	Provider     string
	Model        string
	MaxTokensIn  *int
	MaxTokensOut *int
	Enabled      bool
}

type Router struct {
	DB              *pgxpool.Pool
	Generators      map[string]providers.Generator // keyed by provider name
	Embedders       map[string]providers.Embedder
	refreshInterval time.Duration

	mu        sync.RWMutex
	byTaskTier map[string]map[string]Route // task_type → tier → Route
}

func New(db *pgxpool.Pool, gens map[string]providers.Generator, embs map[string]providers.Embedder, refreshEvery time.Duration) *Router {
	if refreshEvery <= 0 {
		refreshEvery = 30 * time.Second
	}
	return &Router{
		DB:              db,
		Generators:      gens,
		Embedders:       embs,
		refreshInterval: refreshEvery,
		byTaskTier:      map[string]map[string]Route{},
	}
}

// Start kicks off the background refresh loop and does an initial load.
// Errors on initial load are logged but don't block startup — that way
// the service still comes up if the DB is briefly slow, and later
// refreshes will populate the cache.
func (r *Router) Start(ctx context.Context) {
	if err := r.refresh(ctx); err != nil {
		log.Printf("router: initial refresh failed (will retry): %v", err)
	}
	go func() {
		ticker := time.NewTicker(r.refreshInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := r.refresh(ctx); err != nil {
					log.Printf("router: refresh failed: %v", err)
				}
			}
		}
	}()
}

func (r *Router) refresh(ctx context.Context) error {
	rows, err := r.DB.Query(ctx, `
		SELECT task_type, tier, provider, model, max_tokens_in, max_tokens_out, enabled
		  FROM ai_routing`)
	if err != nil {
		return err
	}
	defer rows.Close()
	next := map[string]map[string]Route{}
	for rows.Next() {
		var rt Route
		if err := rows.Scan(&rt.TaskType, &rt.Tier, &rt.Provider, &rt.Model,
			&rt.MaxTokensIn, &rt.MaxTokensOut, &rt.Enabled); err != nil {
			continue
		}
		if next[rt.TaskType] == nil {
			next[rt.TaskType] = map[string]Route{}
		}
		next[rt.TaskType][rt.Tier] = rt
	}
	r.mu.Lock()
	r.byTaskTier = next
	r.mu.Unlock()
	return nil
}

// Resolve returns the enabled route for (task, tier) or a not-found error.
func (r *Router) Resolve(taskType, tier string) (Route, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	m, ok := r.byTaskTier[taskType]
	if !ok {
		return Route{}, false
	}
	rt, ok := m[tier]
	if !ok || !rt.Enabled {
		return Route{}, false
	}
	return rt, true
}

// DispatchResult wraps a provider result with the resolved route used to
// serve it, so the caller (and the usage logger) knows which provider +
// model actually did the work.
type DispatchResult struct {
	Route  Route
	Result *providers.GenerateResult
}

// DispatchGenerate resolves the primary route for taskType, invokes it,
// and on error tries the fallback tier. Returns the result AND the route
// used so the caller can log correctly.
func (r *Router) DispatchGenerate(ctx context.Context, taskType string, req providers.GenerateRequest) (*DispatchResult, error) {
	tried := []string{}
	for _, tier := range []string{"primary", "fallback"} {
		route, ok := r.Resolve(taskType, tier)
		if !ok {
			continue
		}
		gen, ok := r.Generators[route.Provider]
		if !ok {
			tried = append(tried, fmt.Sprintf("%s:%s (unknown provider)", tier, route.Provider))
			continue
		}
		// Apply per-route model + token caps.
		reqCopy := req
		reqCopy.Model = route.Model
		if route.MaxTokensOut != nil && (reqCopy.MaxTokens == 0 || reqCopy.MaxTokens > *route.MaxTokensOut) {
			reqCopy.MaxTokens = *route.MaxTokensOut
		}
		res, err := gen.Generate(ctx, reqCopy)
		if err != nil {
			log.Printf("router: %s tier=%s provider=%s failed: %v", taskType, tier, route.Provider, err)
			tried = append(tried, fmt.Sprintf("%s:%s (%v)", tier, route.Provider, err))
			continue
		}
		return &DispatchResult{Route: route, Result: res}, nil
	}
	return nil, fmt.Errorf("no route succeeded for task %q; tried: %v", taskType, tried)
}

type EmbedDispatchResult struct {
	Route  Route
	Result *providers.EmbedResult
}

func (r *Router) DispatchEmbed(ctx context.Context, taskType string, req providers.EmbedRequest) (*EmbedDispatchResult, error) {
	tried := []string{}
	for _, tier := range []string{"primary", "fallback"} {
		route, ok := r.Resolve(taskType, tier)
		if !ok {
			continue
		}
		emb, ok := r.Embedders[route.Provider]
		if !ok {
			tried = append(tried, fmt.Sprintf("%s:%s (unknown embedder)", tier, route.Provider))
			continue
		}
		reqCopy := req
		reqCopy.Model = route.Model
		res, err := emb.Embed(ctx, reqCopy)
		if err != nil {
			log.Printf("router: embed %s tier=%s provider=%s failed: %v", taskType, tier, route.Provider, err)
			tried = append(tried, fmt.Sprintf("%s:%s (%v)", tier, route.Provider, err))
			continue
		}
		return &EmbedDispatchResult{Route: route, Result: res}, nil
	}
	return nil, fmt.Errorf("no embed route succeeded for task %q; tried: %v", taskType, tried)
}
