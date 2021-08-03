package utils

import (
	"net/http"
	"time"

	"github.com/psinthorn/go_smallsite/configs"
)

var UtilsService utilsInterface = &Utils{}

type Utils utils
type utils struct{}

type utilsInterface interface {
	IsProduction(appConfig *configs.AppConfig)
	StringToTime(timeString string) (time.Time, error)
	IsAuthenticated(*http.Request) bool
}

var appConfig *configs.AppConfig

func NewUtils(a *configs.AppConfig) {
	appConfig = a
}
