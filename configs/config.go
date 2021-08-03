package configs

import (
	"html/template"
	"log"

	"github.com/alexedwards/scs/v2"
	domain_mail "github.com/psinthorn/f2coth/domain/mail"
)

type AppConfig struct {
	UseCache      bool
	TemplateCache map[string]*template.Template
	InfoLog       *log.Logger
	ErrorLog      *log.Logger
	IsProduction  bool
	Session       *scs.SessionManager
	MailChan      chan domain_mail.MailDataTemplate
}
