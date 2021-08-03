package main

import (
	"encoding/gob"
	"net/http"
	"time"

	"github.com/alexedwards/scs/v2"
	domain_reservation "github.com/psinthorn/f2coth/domain/reservations"
	domain "github.com/psinthorn/f2coth/domain/rooms"
	"github.com/psinthorn/f2coth/domain/users"
)

// CreateSession and store session to AppConfig.Session
func CreateSession() {

	// register all models to session maybe use or not use
	gob.Register(users.User{})
	gob.Register(domain.Room{})
	gob.Register(domain.RoomType{})
	gob.Register(domain.RoomStatus{})
	gob.Register(domain.RoomAllotmentStatus{})
	gob.Register(domain_reservation.Reservation{})
	gob.Register(map[string]int{})

	// set up the session
	session = scs.New()
	session.Lifetime = 24 * time.Hour
	session.Cookie.Persist = true
	session.Cookie.SameSite = http.SameSiteLaxMode
	session.Cookie.Secure = appConfig.IsProduction

	appConfig.Session = session

}

// SessionLoad middleware adds and save session on every requests
func SessionLoad(next http.Handler) http.Handler {
	return session.LoadAndSave(next)
}
