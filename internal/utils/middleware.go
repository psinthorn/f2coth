package utils

import (
	"fmt"
	"net/http"

	"github.com/justinas/nosurf"
)

// Middleware variable as middleware type
var (
	Middleware middleware
	//appConfig  configs.AppConfig
)

type middleware struct{}

// Basice middleware for example
func (mdw *middleware) WriteToConsole(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Println("1st basic middleware")
		next.ServeHTTP(w, r)
	})
}

// NoSurf CSRF token generate for protection on all POST requests
func (mdw *middleware) NoSurf(next http.Handler) http.Handler {
	csrfHandler := nosurf.New(next)

	csrfHandler.SetBaseCookie(http.Cookie{
		HttpOnly: true,
		Path:     "/",
		Secure:   false,
		SameSite: http.SameSiteLaxMode,
	})
	return csrfHandler
}

func (mdw *middleware) Auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !UtilsService.IsAuthenticated(r) {
			http.Redirect(w, r, "/users/login", http.StatusSeeOther)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// // SessionLoad middleware adds and save session on every requests
// // *move this middleware to session.go file
// func SessionLoad(next http.Handler) http.Handler {
// 	return session.LoadAndSave(next)
// }
