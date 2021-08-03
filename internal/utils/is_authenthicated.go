package utils

import (
	"net/http"
)

// IsAuthenticated checkied user logged in or not if logged will return true
func (u *Utils) IsAuthenticated(r *http.Request) bool {
	var exists bool
	if appConfig.IsProduction == false {
		exists = true
	} else {
		exists = appConfig.Session.Exists(r.Context(), "user_id")
	}

	return exists
}
