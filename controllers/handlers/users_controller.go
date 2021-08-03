// routes -> controllers -> domain(models)

package controllers

import (
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/psinthorn/f2coth/domain/templates"
	domain "github.com/psinthorn/f2coth/domain/users"
	"golang.org/x/crypto/bcrypt"

	"github.com/psinthorn/f2coth/internal/forms"
	"github.com/psinthorn/f2coth/internal/helpers"
	"github.com/psinthorn/f2coth/internal/render"
)

// var (
// 	UsersController usersController
// )

// type usersControllerInterface interface {
// 	Register(w http.ResponseWriter, r *http.Request)
// 	GetAllUsers(w http.ResponseWriter, r *http.Request)
// 	Login(w http.ResponseWriter, r *http.Request)
// 	Logout(w http.ResponseWriter, r *http.Request)
// }

// type usersController struct {
// }

// AddNewUserForm
func (rp *Repository) AddNewUserForm(w http.ResponseWriter, r *http.Request) {
	var emptyUser domain.User
	data := make(map[string]interface{})
	data["user"] = emptyUser

	render.Template(w, r, "admin-user-add-form.page.html", &templates.TemplateData{
		Form: forms.New(nil),
		Data: data,
	})

}

//  AddNewUser
func (rp *Repository) AddNewUser(w http.ResponseWriter, r *http.Request) {
	err := r.ParseForm()
	if err != nil {
		helpers.ServerError(w, err)
		return
	}

	accessLevel, err := strconv.Atoi(r.Form.Get("access_level"))
	if err != nil {
		panic(err)
	}

	password := r.Form.Get("password")
	hashedPassword, _ := bcrypt.GenerateFromPassword([]byte(password), 12)
	newUser := domain.User{
		FirstName: r.Form.Get("first_name"),
		LastName:  r.Form.Get("last_name"),
		Email:     r.Form.Get("email"),
		Password:  string(hashedPassword),
		// Password:    r.Form.Get("password"),
		AccessLevel: accessLevel,
		Status:      r.Form.Get("status"),
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	// Form validation
	form := forms.New(r.PostForm)
	if !form.Valid() {
		data := make(map[string]interface{})
		data["user"] = newUser
		render.Template(w, r, "admin-user-add-form.page.html", &templates.TemplateData{
			Form: form,
			Data: data,
		})
		return
	}

	_, err = domain.UserService.Create(newUser)
	if err != nil {
		log.Fatal(err)
	}

	rp.App.Session.Put(r.Context(), "user", newUser)
	rp.App.Session.Put(r.Context(), "flash", "New user is added :)")
	http.Redirect(w, r, "/admin/users/register", http.StatusSeeOther)
}

// UpdateUser
func (rp *Repository) UpdateUser(u domain.User) (domain.User, error) {
	var user = domain.User{}
	return user, nil
}

//  GetAllUsers
func (rp *Repository) GetAllUsers(w http.ResponseWriter, r *http.Request) {
	users, err := domain.UserService.GetAllUsers()
	if err != nil {
		helpers.ServerError(w, err)
		return
	}

	data := make(map[string]interface{})
	data["users"] = users

	render.Template(w, r, "admin-users-list.page.html", &templates.TemplateData{
		Data: data,
	})
}
