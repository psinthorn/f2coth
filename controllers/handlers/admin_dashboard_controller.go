package controllers

import (
	"fmt"
	"net/http"

	"github.com/psinthorn/f2coth/domain/templates"
	"github.com/psinthorn/f2coth/internal/render"
)

// GetRoomForm form for create new room
func (rp *Repository) AdminDashBoard(w http.ResponseWriter, r *http.Request) {
	fmt.Println("Print user_idfrom session", rp.App.Session.Get(r.Context(), "user_id"))
	render.Template(w, r, "admin-dashboard-summary.page.html", &templates.TemplateData{})
}
