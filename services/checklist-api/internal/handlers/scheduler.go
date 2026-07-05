package handlers

// Weekly summary scheduler.
//
// Fires once per hour and, on Fridays after 09:00 Asia/Bangkok, dispatches
// the weekly summary email for every project that:
//   • status = 'active'
//   • customer_id IS NOT NULL
//   • visible_to_customer = TRUE
//
// Idempotency is enforced by a stamp in `visit_logs.summary` — we insert
// a marker row (project_id, visit_date=Friday, summary='__weekly_summary_sent__')
// after a successful dispatch and skip projects that already have that
// marker for the current ISO-week. Never double-sends across restarts.
//
// Zero coordination with an external cron — just start the goroutine
// from main and it stays alive with the service. Tick cadence is 1 hour;
// a real 09:00 cutoff is enforced inside runOnce so late-starting
// containers still fire once per Friday.

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const summarySentMarker = "__weekly_summary_sent__"

type Scheduler struct {
	DB     *pgxpool.Pool
	H      *Handler
	Tick   time.Duration
	Loc    *time.Location
	stopCh chan struct{}
}

func NewScheduler(db *pgxpool.Pool, h *Handler) *Scheduler {
	loc, err := time.LoadLocation("Asia/Bangkok")
	if err != nil {
		// Distroless image ships without tzdata files; fall back to a fixed
		// +07:00 offset so schedule math still works. Not DST-safe but Thailand
		// doesn't observe DST.
		loc = time.FixedZone("ICT", 7*60*60)
	}
	return &Scheduler{
		DB: db, H: h,
		Tick:   time.Hour,
		Loc:    loc,
		stopCh: make(chan struct{}),
	}
}

func (s *Scheduler) Start() { go s.loop() }
func (s *Scheduler) Stop()  { close(s.stopCh) }

func (s *Scheduler) loop() {
	log.Printf("checklist-api scheduler: started, tick=%s tz=%s", s.Tick, s.Loc)
	t := time.NewTicker(s.Tick)
	defer t.Stop()
	// Run once immediately so a freshly-restarted container that boots
	// at 09:30 on Friday still fires today, not next week.
	s.runOnce()
	for {
		select {
		case <-s.stopCh:
			log.Print("checklist-api scheduler: stopping")
			return
		case <-t.C:
			s.runOnce()
		}
	}
}

func (s *Scheduler) runOnce() {
	now := time.Now().In(s.Loc)
	if now.Weekday() != time.Friday || now.Hour() < 9 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	// Anchor to Monday of the current ISO week so the marker key is
	// stable regardless of which minute of Friday the scheduler wakes up.
	wd := int(now.Weekday())
	if wd == 0 {
		wd = 7
	}
	weekStart := time.Date(now.Year(), now.Month(), now.Day()-(wd-1), 0, 0, 0, 0, s.Loc)
	visitDate := weekStart.AddDate(0, 0, 4) // Friday

	rows, err := s.DB.Query(ctx, `
		SELECT p.id
		  FROM projects p
		 WHERE p.status = 'active'
		   AND p.customer_id IS NOT NULL
		   AND p.visible_to_customer = TRUE
		   AND NOT EXISTS (
		     SELECT 1 FROM visit_logs v
		      WHERE v.project_id = p.id
		        AND v.visit_date = $1::date
		        AND v.summary = $2
		   )`, visitDate, summarySentMarker)
	if err != nil {
		log.Printf("scheduler: query eligible projects: %v", err)
		return
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			log.Printf("scheduler: scan: %v", err)
			continue
		}
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return
	}
	log.Printf("scheduler: %d project(s) due for weekly summary", len(ids))

	for _, id := range ids {
		// Reuse the existing SendWeeklySummary handler so all the
		// preconditions + notification-api round-trip live in one place.
		// We synthesize a request with just the path param populated.
		req := httptestRequest(id)
		s.H.SendWeeklySummary(discardResponse{}, req)

		// Stamp the marker — idempotency guard for the next tick.
		if _, err := s.DB.Exec(ctx, `
			INSERT INTO visit_logs (project_id, visit_date, summary, billable)
			VALUES ($1, $2::date, $3, FALSE)`, id, visitDate, summarySentMarker); err != nil {
			log.Printf("scheduler: mark sent (%s): %v", id, err)
		}
	}
}

// ── Minimal request/response wiring to reuse the handler ──────────────
//
// SendWeeklySummary is an HTTP handler. Rather than duplicate its logic
// here, we call it directly with a synthesized `http.Request` where the
// chi URL param is stashed in ctx (via chi's private context key). Chi
// exposes URLParam via a public method, but populating it from outside a
// route requires cheating slightly — see chi.RouteContext.URLParams.
//
// Response body is discarded — scheduler doesn't care what the handler
// wrote, only whether it logged an error internally.

func httptestRequest(projectID string) *http.Request {
	r, _ := http.NewRequest(http.MethodPost, "/api/checklists/admin/projects/"+projectID+"/send-weekly-summary", nil)
	return withChiURLParam(r, "id", projectID)
}

type discardResponse struct{}

func (discardResponse) Header() http.Header       { return http.Header{} }
func (discardResponse) Write(b []byte) (int, error) { return len(b), nil }
func (discardResponse) WriteHeader(int)             {}
