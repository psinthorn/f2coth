// routes -> controllers -> services -> domain

package controllers

import (
	"fmt"
	"net/http"

	"github.com/psinthorn/f2coth/domain/templates"
	"github.com/psinthorn/f2coth/internal/render"
)

// var (
// 	PagesController pagesController
// )

// type pagesControllerInterface interface {
// 	Home(w http.ResponseWriter, r *http.Request)
// 	About(w http.ResponseWriter, r *http.Request)
// 	Rooms(w http.ResponseWriter, r *http.Request)
// 	Superior(w http.ResponseWriter, r *http.Request)
// 	Deluxe(w http.ResponseWriter, r *http.Request)
// 	Contact(w http.ResponseWriter, r *http.Request)
// }

// type pagesController struct {
// 	// App *configs.AppConfig
// 	// DB  interface{}
// }

// Home is home page render
func (rp *Repository) Home(w http.ResponseWriter, r *http.Request) {
	remoteIP := r.RemoteAddr
	fmt.Println(remoteIP)
	rp.App.Session.Put(r.Context(), "remote_ip", remoteIP)

	stringMap := make(map[string]string)
	stringMap["greet"] = "Hello Go"

	render.Template(w, r, "home.page.html", &templates.TemplateData{
		StringMap: stringMap,
	})
}

// About is about page render
func (rp *Repository) About(w http.ResponseWriter, r *http.Request) {
	stringMap := make(map[string]string)
	remoteIP := rp.App.Session.GetString(r.Context(), "remote_ip")
	stringMap["remote_ip"] = remoteIP

	render.Template(w, r, "about.page.html", &templates.TemplateData{
		StringMap: stringMap,
	})

}

// Room is room page render
func (rp *Repository) Rooms(w http.ResponseWriter, r *http.Request) {
	stringMap := make(map[string]string)
	remoteIP := rp.App.Session.GetString(r.Context(), "remote_ip")
	stringMap["remote_ip"] = remoteIP

	render.Template(w, r, "rooms.page.html", &templates.TemplateData{
		StringMap: stringMap,
	})

}

// Superior is room page render
func (rp *Repository) Superior(w http.ResponseWriter, r *http.Request) {
	stringMap := make(map[string]string)
	remoteIP := rp.App.Session.GetString(r.Context(), "remote_ip")
	stringMap["remote_ip"] = remoteIP

	render.Template(w, r, "room-superior.page.html", &templates.TemplateData{
		StringMap: stringMap,
	})

}

// Superior is room page render
func (rp *Repository) Deluxe(w http.ResponseWriter, r *http.Request) {
	stringMap := make(map[string]string)
	remoteIP := rp.App.Session.GetString(r.Context(), "remote_ip")
	stringMap["remote_ip"] = remoteIP

	render.Template(w, r, "room-deluxe.page.html", &templates.TemplateData{
		StringMap: stringMap,
	})

}

// Contact is contact page render
func (rp *Repository) Contact(w http.ResponseWriter, r *http.Request) {
	stringMap := make(map[string]string)
	remoteIP := rp.App.Session.GetString(r.Context(), "remote_ip")
	stringMap["remote_ip"] = remoteIP

	render.Template(w, r, "contact.page.html", &templates.TemplateData{
		StringMap: stringMap,
	})

}
