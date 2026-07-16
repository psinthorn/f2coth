package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	assets "github.com/f2cothai/f2-website/services/assethub-api"
)

// DownloadCollector serves an embedded client tool (collect.sh / collect.ps1 /
// discover.sh / docker-compose.probe.yml). Unauthenticated behind the module
// gate: the scripts carry no secrets (the enrollment token is passed at
// runtime), and techs need to `curl` them onto client machines that have no
// F2 login.
func (h *Handler) DownloadCollector(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	body, mime, ok := assets.Collector(name)
	if !ok {
		writeErr(w, http.StatusNotFound, "unknown collector")
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Disposition", "attachment; filename="+name)
	w.Header().Set("Cache-Control", "public, max-age=300")
	_, _ = w.Write(body)
}
