package main

import (
	"log"
	"os"

	//"github.com/psinthorn/go_smallsite/controllers"
	controllers "github.com/psinthorn/f2coth/controllers/handlers"
	domain_mail "github.com/psinthorn/f2coth/domain/mail"
	"github.com/psinthorn/f2coth/internal/render"
	"github.com/psinthorn/f2coth/internal/utils"
)

var infoLog *log.Logger
var errorLog *log.Logger

// Start use to start new server
func StartApp() error {

	// Check env is production
	utils.UtilsService.IsProduction(&appConfig)

	// Write server and client error log to logs file
	infoLog = log.New(os.Stdout, "Info\t", log.Ldate|log.Ltime)
	errorLog = log.New(os.Stdout, "ERROR\t", log.Ldate|log.Ltime|log.Lshortfile)
	appConfig.InfoLog = infoLog
	appConfig.ErrorLog = errorLog

	// Start session
	CreateSession()

	//Creat mail chanel
	mailChan := make(chan domain_mail.MailDataTemplate)
	appConfig.MailChan = mailChan

	// Create new template
	tmplCache, err := render.CreateTemplateCache()
	if err != nil {
		return err
	}

	// Create and load config to templates
	appConfig.TemplateCache = tmplCache
	appConfig.UseCache = false
	newHandlerRepo := controllers.NewHandlerRepository(&appConfig)
	controllers.NewHandlers(newHandlerRepo)
	render.NewRender(&appConfig)
	utils.NewUtils(&appConfig)

	// return database connect to startApp function
	return nil

}
