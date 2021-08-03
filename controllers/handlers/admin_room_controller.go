package controllers

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	domain_reservation "github.com/psinthorn/go_smallsite/domain/reservations"
	domain "github.com/psinthorn/go_smallsite/domain/rooms"
	"github.com/psinthorn/go_smallsite/domain/templates"
	"github.com/psinthorn/go_smallsite/internal/forms"
	"github.com/psinthorn/go_smallsite/internal/helpers"
	"github.com/psinthorn/go_smallsite/internal/render"
)

// GetRoomForm form for create new room
func (rp *Repository) RoomGetAll(w http.ResponseWriter, r *http.Request) {
	rooms, err := domain.RoomService.Get()
	if err != nil {
		helpers.ServerError(w, err)
	}

	data := make(map[string]interface{})
	data["rooms"] = rooms
	render.Template(w, r, "room-list.page.html", &templates.TemplateData{
		Data: data,
	})
}

// GetRoomForm form for create new room
func (rp *Repository) AddNewRoomForm(w http.ResponseWriter, r *http.Request) {
	var emptyRoom domain.Room
	data := make(map[string]interface{})
	data["room"] = emptyRoom

	render.Template(w, r, "room-add-form.page.html", &templates.TemplateData{
		Form: forms.New(nil),
		Data: data,
	})
}

// PostReservation is reservation page render
func (rp *Repository) AddNewRoom(w http.ResponseWriter, r *http.Request) {
	err := r.ParseForm()
	if err != nil {
		helpers.ServerError(w, err)
		return
	}

	roomTypeId, err := strconv.Atoi(r.Form.Get("roomtype_id"))
	if err != nil {
		panic(err)
	}
	room := domain.Room{
		RoomTypeId: roomTypeId,
		RoomName:   r.Form.Get("room_name"),
		//RoomNo:      r.Form.Get("room_no"),
		Description: r.Form.Get("description"),
		Status:      r.Form.Get("status"),
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	fmt.Println(room)

	// Form validation form validation not pass then create new form and pass data back to form
	form := forms.New(r.PostForm)
	if !form.Valid() {
		data := make(map[string]interface{})
		data["room"] = room
		render.Template(w, r, "room-add-form.page.html", &templates.TemplateData{
			Form: form,
			Data: data,
		})
		return
	}

	_, err = domain.RoomService.Create(room)
	if err != nil {
		panic(err)
	}

	rp.App.Session.Put(r.Context(), "room", room)
	rp.App.Session.Put(r.Context(), "success", "New room is added :)")
	http.Redirect(w, r, "/admin/rooms/room", http.StatusSeeOther)

}

// ReservationSummary for customer recheck information before submit
func (rp *Repository) RoomSummary(w http.ResponseWriter, r *http.Request) {
	reservation, ok := rp.App.Session.Get(r.Context(), "reservation").(domain_reservation.Reservation)
	if !ok {
		rp.App.ErrorLog.Println("can't get reservation information from session")
		rp.App.Session.Put(r.Context(), "error", "can't get reservation information from session")
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
		return
	}

	rp.App.Session.Remove(r.Context(), "reservation")

	data := make(map[string]interface{})
	data["reservation"] = reservation
	render.Template(w, r, "reservation-summary.page.html", &templates.TemplateData{
		Data: data,
	})
}

// RoomsAll show all rooms
func (rp *Repository) RoomsAll() (domain.Room, error) {
	var roomsAll = domain.Room{}
	return roomsAll, nil
}
