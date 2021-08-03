package controllers

import (
	"fmt"
	"net/http"
	"time"

	domain "github.com/psinthorn/go_smallsite/domain/rooms"
	"github.com/psinthorn/go_smallsite/domain/templates"
	"github.com/psinthorn/go_smallsite/internal/forms"
	"github.com/psinthorn/go_smallsite/internal/helpers"
	"github.com/psinthorn/go_smallsite/internal/render"
)

// GetRoomStatus
func (rp *Repository) GetAllRoomStatus(w http.ResponseWriter, r *http.Request) {

}

func (rp *Repository) AddNewRoomStatusForm(w http.ResponseWriter, r *http.Request) {
	var emptyRoomStatus domain.RoomStatus
	data := make(map[string]interface{})
	data["room"] = emptyRoomStatus

	render.Template(w, r, "admin-roomstatus-add-form.page.html", &templates.TemplateData{
		Form: forms.New(nil),
		Data: data,
	})

}

func (rp *Repository) AddNewRoomStatus(w http.ResponseWriter, r *http.Request) {
	// Parse Form
	err := r.ParseForm()
	if err != nil {
		helpers.ServerError(w, err)
		return
	}

	// Receive form value and pass to room status models
	roomStatus := domain.RoomStatus{
		Title:       r.Form.Get("title"),
		Description: r.Form.Get("description"),
		Status:      r.Form.Get("status"),
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	//
	form := forms.New(r.PostForm)
	if !form.Valid() {
		data := make(map[string]interface{})
		data["room"] = roomStatus
		render.Template(w, r, "room-status-add-form.page.html", &templates.TemplateData{
			Form: form,
			Data: data,
		})
		return
	}

	_, err = domain.RoomStatusService.Create(roomStatus)
	if err != nil {
		fmt.Println(err)
		return
	}

	rp.App.Session.Put(r.Context(), "room_status", roomStatus)
	rp.App.Session.Put(r.Context(), "success", "New room status is added :)")
	http.Redirect(w, r, "/admin/rooms/room-status", http.StatusSeeOther)

}
