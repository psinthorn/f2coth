// Package handlers exposes the orchestrator's HTTP surface.
//
// Public paths (behind api.ai_orchestrator module gate + admin JWT):
//   POST /api/ai/generate         — dispatch a text-generation task
//   POST /api/ai/embed            — dispatch an embedding task
//   GET  /api/ai/admin/routing    — list every routing rule
//   PATCH /api/ai/admin/routing/{id} — update a rule (provider/model/enabled)
//   GET  /api/ai/admin/usage      — month-to-date summary + per-task breakdown
//   GET  /api/ai/admin/usage/entries — recent log entries (paginated)
//
// All admin paths require staff JWT with role='admin'. The generate/embed
// paths accept the same JWT (or a service-to-service call from other
// F2 microservices in the future).
package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	mw "github.com/f2cothai/f2-website/services/ai-orchestrator-api/internal/middleware"
	"github.com/f2cothai/f2-website/services/ai-orchestrator-api/internal/providers"
	"github.com/f2cothai/f2-website/services/ai-orchestrator-api/internal/router"
	"github.com/f2cothai/f2-website/services/ai-orchestrator-api/internal/usage"
)

type Handler struct {
	DB     *pgxpool.Pool
	Router *router.Router
	Usage  *usage.Logger
}

// ---------- Common helpers ----------

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
func actorID(r *http.Request) *string {
	v, _ := r.Context().Value(mw.CtxUserID).(string)
	if v == "" {
		return nil
	}
	return &v
}

// ---------- Generate ----------

type generateReq struct {
	TaskType    string               `json:"task_type"`
	System      string               `json:"system,omitempty"`
	Messages    []providers.Message  `json:"messages"`
	MaxTokens   int                  `json:"max_tokens,omitempty"`
	Temperature float64              `json:"temperature,omitempty"`
	CachePrompt bool                 `json:"cache_prompt,omitempty"`
	SessionID   string               `json:"session_id,omitempty"`
}

type generateResp struct {
	Text         string  `json:"text"`
	Provider     string  `json:"provider"`
	Model        string  `json:"model"`
	InputTokens  int     `json:"input_tokens"`
	OutputTokens int     `json:"output_tokens"`
	CostUSD      float64 `json:"cost_usd"`
	LatencyMS    int     `json:"latency_ms"`
}

func (h *Handler) Generate(w http.ResponseWriter, r *http.Request) {
	var req generateReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 512*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.TaskType == "" {
		writeErr(w, http.StatusBadRequest, "task_type required")
		return
	}
	if len(req.Messages) == 0 {
		writeErr(w, http.StatusBadRequest, "messages required")
		return
	}

	res, err := h.Router.DispatchGenerate(r.Context(), req.TaskType, providers.GenerateRequest{
		System:            req.System,
		Messages:          req.Messages,
		MaxTokens:         req.MaxTokens,
		Temperature:       req.Temperature,
		EnablePromptCache: req.CachePrompt,
	})
	if err != nil {
		// Log the failure so admins can see it in the usage dashboard.
		errStr := err.Error()
		h.Usage.Log(usage.Entry{
			TaskType: req.TaskType,
			Provider: "none",
			Model:    "none",
			Error:    &errStr,
			ActorID:  actorID(r),
			SessionID: nullIfEmpty(req.SessionID),
		})
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}

	// Fire-and-forget usage log.
	h.Usage.Log(usage.Entry{
		TaskType:   req.TaskType,
		Provider:   res.Route.Provider,
		Model:      res.Result.Model,
		InputTok:   res.Result.InputTokens,
		OutputTok:  res.Result.OutputTokens,
		CacheRead:  res.Result.CacheReadTokens,
		CacheWrite: res.Result.CacheWriteTokens,
		LatencyMS:  res.Result.LatencyMS,
		ActorID:    actorID(r),
		SessionID:  nullIfEmpty(req.SessionID),
	})

	writeJSON(w, http.StatusOK, generateResp{
		Text:         res.Result.Text,
		Provider:     res.Route.Provider,
		Model:        res.Result.Model,
		InputTokens:  res.Result.InputTokens,
		OutputTokens: res.Result.OutputTokens,
		CostUSD:      providers.CostUSD(res.Route.Provider, res.Result.Model, res.Result.InputTokens, res.Result.OutputTokens, res.Result.CacheReadTokens, res.Result.CacheWriteTokens),
		LatencyMS:    res.Result.LatencyMS,
	})
}

// ---------- Embed ----------

type embedReq struct {
	TaskType string   `json:"task_type"`
	Texts    []string `json:"texts"`
}
type embedResp struct {
	Vectors     [][]float32 `json:"vectors"`
	Provider    string      `json:"provider"`
	Model       string      `json:"model"`
	InputTokens int         `json:"input_tokens"`
	LatencyMS   int         `json:"latency_ms"`
}

func (h *Handler) Embed(w http.ResponseWriter, r *http.Request) {
	var req embedReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.TaskType == "" {
		req.TaskType = "embeddings"
	}
	if len(req.Texts) == 0 {
		writeErr(w, http.StatusBadRequest, "texts required")
		return
	}
	res, err := h.Router.DispatchEmbed(r.Context(), req.TaskType, providers.EmbedRequest{Texts: req.Texts})
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	h.Usage.Log(usage.Entry{
		TaskType:  req.TaskType,
		Provider:  res.Route.Provider,
		Model:     res.Result.Model,
		InputTok:  res.Result.InputTokens,
		LatencyMS: res.Result.LatencyMS,
		ActorID:   actorID(r),
	})
	writeJSON(w, http.StatusOK, embedResp{
		Vectors:     res.Result.Vectors,
		Provider:    res.Route.Provider,
		Model:       res.Result.Model,
		InputTokens: res.Result.InputTokens,
		LatencyMS:   res.Result.LatencyMS,
	})
}

// ---------- Admin: routing CRUD ----------

type routingRow struct {
	ID           string  `json:"id"`
	TaskType     string  `json:"task_type"`
	Tier         string  `json:"tier"`
	Provider     string  `json:"provider"`
	Model        string  `json:"model"`
	MaxTokensIn  *int    `json:"max_tokens_in,omitempty"`
	MaxTokensOut *int    `json:"max_tokens_out,omitempty"`
	Enabled      bool    `json:"enabled"`
	Notes        *string `json:"notes,omitempty"`
	UpdatedAt    string  `json:"updated_at"`
}

func (h *Handler) AdminListRouting(w http.ResponseWriter, r *http.Request) {
	rows, err := h.DB.Query(r.Context(), `
		SELECT id::text, task_type, tier, provider, model, max_tokens_in, max_tokens_out,
		       enabled, notes, updated_at::text
		  FROM ai_routing
		 ORDER BY task_type, tier`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	out := []routingRow{}
	for rows.Next() {
		var rr routingRow
		if err := rows.Scan(&rr.ID, &rr.TaskType, &rr.Tier, &rr.Provider, &rr.Model,
			&rr.MaxTokensIn, &rr.MaxTokensOut, &rr.Enabled, &rr.Notes, &rr.UpdatedAt); err != nil {
			continue
		}
		out = append(out, rr)
	}
	writeJSON(w, http.StatusOK, map[string]any{"routes": out})
}

type routingPatch struct {
	Provider     *string `json:"provider"`
	Model        *string `json:"model"`
	MaxTokensIn  *int    `json:"max_tokens_in"`
	MaxTokensOut *int    `json:"max_tokens_out"`
	Enabled      *bool   `json:"enabled"`
	Notes        *string `json:"notes"`
}

func (h *Handler) AdminPatchRoute(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "id required")
		return
	}
	var req routingPatch
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	tag, err := h.DB.Exec(r.Context(), `
		UPDATE ai_routing SET
		    provider       = COALESCE($2, provider),
		    model          = COALESCE($3, model),
		    max_tokens_in  = COALESCE($4, max_tokens_in),
		    max_tokens_out = COALESCE($5, max_tokens_out),
		    enabled        = COALESCE($6, enabled),
		    notes          = COALESCE($7, notes)
		 WHERE id = $1::uuid`,
		id, req.Provider, req.Model, req.MaxTokensIn, req.MaxTokensOut, req.Enabled, req.Notes,
	)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "update failed")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "route not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------- Admin: usage stats ----------

type usageSummary struct {
	MonthToDateUSD float64            `json:"mtd_cost_usd"`
	TodayUSD       float64            `json:"today_cost_usd"`
	BudgetUSD      float64            `json:"budget_usd"`
	PctUsed        float64            `json:"pct_used"`
	CallsMTD       int                `json:"calls_mtd"`
	ByTask         []taskAggregate    `json:"by_task"`
	ByProvider     []providerAggregate `json:"by_provider"`
}

type taskAggregate struct {
	TaskType   string  `json:"task_type"`
	Calls      int     `json:"calls"`
	InputTok   int64   `json:"tokens_in"`
	OutputTok  int64   `json:"tokens_out"`
	CostUSD    float64 `json:"cost_usd"`
}
type providerAggregate struct {
	Provider  string  `json:"provider"`
	Calls     int     `json:"calls"`
	InputTok  int64   `json:"tokens_in"`
	OutputTok int64   `json:"tokens_out"`
	CostUSD   float64 `json:"cost_usd"`
}

func (h *Handler) AdminUsageSummary(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var mtd, today float64
	var calls int
	if err := h.DB.QueryRow(ctx, `
		SELECT
		  COALESCE(SUM(cost_usd) FILTER (WHERE at >= date_trunc('month', NOW())), 0),
		  COALESCE(SUM(cost_usd) FILTER (WHERE at >= date_trunc('day',   NOW())), 0),
		  COALESCE(COUNT(*)      FILTER (WHERE at >= date_trunc('month', NOW())), 0)
		  FROM ai_usage_log`).Scan(&mtd, &today, &calls); err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}

	byTask, err := h.aggregateByTask(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	byProv, err := h.aggregateByProvider(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}

	budget := 0.0
	// Budget echoed in the response so the UI can render the % ring
	// without a second request. Pulled from the same env the logger
	// uses via a small wrapper on the request context (see main).
	if v, ok := ctx.Value(ctxKeyBudget).(float64); ok {
		budget = v
	}
	pct := 0.0
	if budget > 0 {
		pct = (mtd / budget) * 100
	}

	writeJSON(w, http.StatusOK, usageSummary{
		MonthToDateUSD: mtd,
		TodayUSD:       today,
		BudgetUSD:      budget,
		PctUsed:        pct,
		CallsMTD:       calls,
		ByTask:         byTask,
		ByProvider:     byProv,
	})
}

func (h *Handler) aggregateByTask(ctx context.Context) ([]taskAggregate, error) {
	rows, err := h.DB.Query(ctx, `
		SELECT task_type, COUNT(*), COALESCE(SUM(tokens_in),0),
		       COALESCE(SUM(tokens_out),0), COALESCE(SUM(cost_usd),0)
		  FROM ai_usage_log
		 WHERE at >= date_trunc('month', NOW())
		 GROUP BY task_type
		 ORDER BY SUM(cost_usd) DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []taskAggregate{}
	for rows.Next() {
		var a taskAggregate
		if err := rows.Scan(&a.TaskType, &a.Calls, &a.InputTok, &a.OutputTok, &a.CostUSD); err != nil {
			continue
		}
		out = append(out, a)
	}
	return out, nil
}

func (h *Handler) aggregateByProvider(ctx context.Context) ([]providerAggregate, error) {
	rows, err := h.DB.Query(ctx, `
		SELECT provider, COUNT(*), COALESCE(SUM(tokens_in),0),
		       COALESCE(SUM(tokens_out),0), COALESCE(SUM(cost_usd),0)
		  FROM ai_usage_log
		 WHERE at >= date_trunc('month', NOW())
		 GROUP BY provider
		 ORDER BY SUM(cost_usd) DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []providerAggregate{}
	for rows.Next() {
		var a providerAggregate
		if err := rows.Scan(&a.Provider, &a.Calls, &a.InputTok, &a.OutputTok, &a.CostUSD); err != nil {
			continue
		}
		out = append(out, a)
	}
	return out, nil
}

// ---------- Admin: usage entries (recent) ----------

type usageEntry struct {
	At        string  `json:"at"`
	TaskType  string  `json:"task_type"`
	Provider  string  `json:"provider"`
	Model     string  `json:"model"`
	InputTok  int     `json:"tokens_in"`
	OutputTok int     `json:"tokens_out"`
	CostUSD   float64 `json:"cost_usd"`
	LatencyMS int     `json:"latency_ms"`
	Error     *string `json:"error,omitempty"`
}

func (h *Handler) AdminUsageEntries(w http.ResponseWriter, r *http.Request) {
	limit := 100
	if q := r.URL.Query().Get("limit"); q != "" {
		if v, err := strconv.Atoi(q); err == nil && v > 0 && v <= 500 {
			limit = v
		}
	}
	taskFilter := strings.TrimSpace(r.URL.Query().Get("task_type"))
	rows, err := h.DB.Query(r.Context(), `
		SELECT at::text, task_type, provider, model, tokens_in, tokens_out,
		       cost_usd, latency_ms, error
		  FROM ai_usage_log
		 WHERE ($1 = '' OR task_type = $1)
		 ORDER BY at DESC
		 LIMIT $2`, taskFilter, limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	out := []usageEntry{}
	for rows.Next() {
		var e usageEntry
		if err := rows.Scan(&e.At, &e.TaskType, &e.Provider, &e.Model,
			&e.InputTok, &e.OutputTok, &e.CostUSD, &e.LatencyMS, &e.Error); err != nil {
			continue
		}
		out = append(out, e)
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": out})
}

// ---------- context key for budget echoed in summary ----------

type budgetCtx struct{}

var ctxKeyBudget = budgetCtx{}

// WithBudget stashes the monthly USD budget cap in the request context
// so AdminUsageSummary can echo it back without a second env read.
func WithBudget(ctx context.Context, usd float64) context.Context {
	return context.WithValue(ctx, ctxKeyBudget, usd)
}

func nullIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
