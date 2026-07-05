// Package usage writes ai_usage_log rows after each provider call and
// evaluates budget thresholds. Writes are asynchronous (non-blocking on
// the request path) via a small buffered channel — losing a log row is
// preferable to slowing down user-facing responses.
package usage

import (
	"context"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/f2cothai/f2-website/services/ai-orchestrator-api/internal/providers"
)

type Entry struct {
	TaskType    string
	Provider    string
	Model       string
	InputTok    int
	OutputTok   int
	CacheRead   int
	CacheWrite  int
	LatencyMS   int
	SessionID   *string
	ActorID     *string
	Error       *string
}

type Logger struct {
	DB       *pgxpool.Pool
	BudgetUSD float64

	ch chan Entry
	// alertedThisMonth is a soft debounce — we only emit a budget-alert
	// log line once per calendar month per instance boot. Restarting
	// the container resets this, which is fine given how rare that is.
	alertedThisMonth bool
	monthKey         string
}

func New(db *pgxpool.Pool, budgetUSD float64) *Logger {
	return &Logger{
		DB:        db,
		BudgetUSD: budgetUSD,
		ch:        make(chan Entry, 256),
	}
}

// Start launches the writer goroutine. Call once at boot.
func (l *Logger) Start(ctx context.Context) {
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case e := <-l.ch:
				l.write(ctx, e)
			}
		}
	}()
}

// Log queues an entry. Non-blocking: if the buffer is full we drop and
// warn — a stalled DB shouldn't slow down user requests.
func (l *Logger) Log(e Entry) {
	select {
	case l.ch <- e:
	default:
		log.Printf("usage: buffer full, dropping entry task=%s provider=%s", e.TaskType, e.Provider)
	}
}

func (l *Logger) write(ctx context.Context, e Entry) {
	cost := providers.CostUSD(e.Provider, e.Model, e.InputTok, e.OutputTok, e.CacheRead, e.CacheWrite)
	_, err := l.DB.Exec(ctx, `
		INSERT INTO ai_usage_log
		    (task_type, provider, model, tokens_in, tokens_out,
		     cache_read_tokens, cache_write_tokens, cost_usd, latency_ms,
		     session_id, actor_id, error)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
		     NULLIF($10,'')::uuid, NULLIF($11,'')::uuid, NULLIF($12,''))`,
		e.TaskType, e.Provider, e.Model, e.InputTok, e.OutputTok,
		e.CacheRead, e.CacheWrite, cost, e.LatencyMS,
		strOrEmpty(e.SessionID), strOrEmpty(e.ActorID), strOrEmpty(e.Error),
	)
	if err != nil {
		log.Printf("usage: write failed: %v", err)
		return
	}
	l.checkBudget(ctx)
}

// checkBudget reads month-to-date spend and warns once when we cross
// BudgetUSD. Actual admin notification (email/Slack) is a follow-up —
// this MVP only logs a warning line the operator can grep.
func (l *Logger) checkBudget(ctx context.Context) {
	if l.BudgetUSD <= 0 {
		return
	}
	nowKey := time.Now().UTC().Format("2006-01")
	if nowKey != l.monthKey {
		l.monthKey = nowKey
		l.alertedThisMonth = false
	}
	if l.alertedThisMonth {
		return
	}
	var mtd float64
	err := l.DB.QueryRow(ctx, `
		SELECT COALESCE(SUM(cost_usd),0)
		  FROM ai_usage_log
		 WHERE at >= date_trunc('month', NOW())`).Scan(&mtd)
	if err != nil {
		return
	}
	if mtd >= l.BudgetUSD {
		log.Printf("BUDGET_ALERT: month-to-date AI spend $%.2f crossed cap $%.2f (%s). Investigate ai_usage_log.", mtd, l.BudgetUSD, nowKey)
		l.alertedThisMonth = true
	}
}

func strOrEmpty(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
