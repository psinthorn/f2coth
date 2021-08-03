package controllers

import (
	"fmt"
	"net/http"

	domain_reservation "github.com/psinthorn/go_smallsite/domain/reservations"
	"github.com/psinthorn/go_smallsite/domain/templates"
	"github.com/psinthorn/go_smallsite/internal/helpers"
	"github.com/psinthorn/go_smallsite/internal/render"
)

// ReservationLists Show all current reservations
func (rp *Repository) ReservationLists(w http.ResponseWriter, r *http.Request) {
	rsvns, err := domain_reservation.ReservationService.GetAll()
	if err != nil {
		helpers.ServerError(w, err)
		return
	}

	data := make(map[string]interface{})
	data["reservations"] = rsvns
	render.Template(w, r, "admin-reservations-list.page.html", &templates.TemplateData{
		Data: data,
	})
}

func (rp *Repository) ReservationAddForm(w http.ResponseWriter, r *http.Request) {
	fmt.Println("Show add new reservation form")

}

func (rp *Repository) ReservationAdd(w http.ResponseWriter, r *http.Request) {
	fmt.Println("Post add")

}

func (rp *Repository) ReservationDetails(w http.ResponseWriter, r *http.Request) {
	render.Template(w, r, "admin-reservations-details.page.html", &templates.TemplateData{})
}

func (rp *Repository) ReservationEditForm(w http.ResponseWriter, r *http.Request) {
	fmt.Println("Show edit form")

}

func (rp *Repository) ReservationEdit(w http.ResponseWriter, r *http.Request) {
	fmt.Println("Post edit")

}

func (rp *Repository) ReservationDelete(w http.ResponseWriter, r *http.Request) {
	fmt.Println("Post delete reseration")

}
