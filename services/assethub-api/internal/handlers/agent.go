package handlers

import (
	"net/http"
)

// pollResponse tells a daemon agent whether to run a scan now and how long to
// wait before polling again.
type pollResponse struct {
	Run     bool `json:"run"`
	PollMin int  `json:"poll_min"`
}

// AgentPoll handles GET /api/assethub/agent/poll — a daemon agent (run.sh
// --daemon) checks in with its enrollment token. Auth is by token (not JWT),
// mirroring ingest. run=true when an operator pressed "Scan now" since the last
// run, or the rescan interval has elapsed.
func (h *Handler) AgentPoll(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	scope, err := h.resolveToken(ctx, r)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "invalid enrollment token")
		return
	}

	var (
		run     bool
		pollMin int
	)
	// Compute run server-side so all timing logic lives in one place:
	//   requested-since-last-run  OR  interval elapsed since last run.
	err = h.DB.QueryRow(ctx, `
		SELECT
		  (scan_requested_at IS NOT NULL
		     AND scan_requested_at > COALESCE(last_scan_at, 'epoch'))
		  OR (COALESCE(last_scan_at, 'epoch') < NOW() - make_interval(mins => rescan_interval_min))
		  AS run,
		  GREATEST(poll_interval_min, 1) AS poll_min
		FROM assethub_enrollment_tokens
		WHERE id = $1 AND revoked_at IS NULL`, scope.TokenID).Scan(&run, &pollMin)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "poll failed")
		return
	}
	writeJSON(w, http.StatusOK, pollResponse{Run: run, PollMin: pollMin})
}

// AgentAck handles POST /api/assethub/agent/ack — the agent reports it has run,
// so the server stamps last_scan_at and clears any pending Scan-now request.
func (h *Handler) AgentAck(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	scope, err := h.resolveToken(ctx, r)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "invalid enrollment token")
		return
	}
	if _, err := h.DB.Exec(ctx, `
		UPDATE assethub_enrollment_tokens
		SET last_scan_at = NOW(), scan_requested_at = NULL
		WHERE id = $1`, scope.TokenID); err != nil {
		writeErr(w, http.StatusInternalServerError, "ack failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
