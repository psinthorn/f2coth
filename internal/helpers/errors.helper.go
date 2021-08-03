package helpers

import (
	"fmt"
	"net/http"
	"runtime/debug"

	"github.com/psinthorn/go_smallsite/configs"
)

var app *configs.AppConfig

func NewErrorHelper(a *configs.AppConfig) {
	app = a
}

func ClientError(w http.ResponseWriter, status int) {
	app.InfoLog.Println("Client error with status code: ", status)
	http.Error(w, http.StatusText(status), status)
}

func ServerError(w http.ResponseWriter, err error) {
	trace := fmt.Sprintf("%s\n%s", err.Error(), debug.Stack())
	//app.ErrorLog.Println(trace)
	fmt.Println(trace)
	http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
}
