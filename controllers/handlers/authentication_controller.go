package controllers

import (
	"fmt"
	"log"
	"net/http"

	"github.com/psinthorn/f2coth/domain/templates"
	"github.com/psinthorn/f2coth/domain/users"
	"github.com/psinthorn/f2coth/internal/forms"
	"github.com/psinthorn/f2coth/internal/render"
)

// Login user login page
func (rp *Repository) Login(w http.ResponseWriter, r *http.Request) {
	render.Template(w, r, "login.page.html", &templates.TemplateData{
		Form: forms.New(nil),
	})
	//rp.App.Session.Put(r.Context(), "success", "Log in success :)")
}

// Authenticate
func (rp *Repository) PostLogin(w http.ResponseWriter, r *http.Request) {
	_ = rp.App.Session.RenewToken(r.Context())
	err := r.ParseForm()
	if err != nil {
		log.Println("error found", err)
	}

	email := r.Form.Get("email")
	password := r.Form.Get("password")

	form := forms.New(r.PostForm)
	form.Required("email", "password")
	form.IsEmail("email")

	stringMap := make(map[string]string)
	stringMap["email"] = email
	stringMap["password"] = password

	if !form.Valid() {
		render.Template(w, r, "login.page.html", &templates.TemplateData{
			Form:      form,
			StringMap: stringMap,
			// Data:      data,
		})
		return
	}

	user, err := users.UserService.Authenticate(email, password)
	if err != nil {
		log.Println("error:", err)
		rp.App.Session.Put(r.Context(), "error", "invalid login credentials")
		render.Template(w, r, "login.page.html", &templates.TemplateData{
			Form:      form,
			StringMap: stringMap,
			// Data:      data,
		})
		return
	}

	rp.App.Session.Put(r.Context(), "user_id", user.ID)
	fmt.Println("Print r_contxt", r.Context(), "user_id")
	fmt.Println("Print user_idfrom session", rp.App.Session.Get(r.Context(), "user_id"))
	rp.App.Session.Put(r.Context(), "success", "Logged in sucessfully")
	// render.Template(w, r, "admin-dashboard-summary.page.html", &templates.TemplateData{})
	http.Redirect(w, r, "/admin/dashboard", http.StatusSeeOther)

}

// Login user login page
func (rp *Repository) Logout(w http.ResponseWriter, r *http.Request) {
	_ = rp.App.Session.Destroy(r.Context())
	_ = rp.App.Session.RenewToken(r.Context())
	http.Redirect(w, r, "/users/login", http.StatusSeeOther)
	//render.Template(w, r, "login.page.html", &models.TemplateData{})
}
