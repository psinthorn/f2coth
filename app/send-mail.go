package main

import (
	"fmt"
	"io/ioutil"
	"log"
	"strings"
	"time"

	domain_mail "github.com/psinthorn/f2coth/domain/mail"
	mail "github.com/xhit/go-simple-mail/v2"
)

func sendMailListen() {
	// Create background runing process by create go routine
	go func() {
		for {
			msg := <-appConfig.MailChan
			sendMail(msg)
		}
	}()
}

func sendMail(m domain_mail.MailDataTemplate) {
	server := mail.NewSMTPClient()
	server.Host = "localhost"
	server.Port = 1025
	server.KeepAlive = false
	server.ConnectTimeout = 10 * time.Second
	server.SendTimeout = 10 * time.Second
	// server.Username
	// server.Password
	// server.Encryption

	client, err := server.Connect()
	if err != nil {
		errorLog.Println(err)
	}

	email := mail.NewMSG()
	email.SetFrom(m.From).AddTo(m.To).SetSubject(m.Subject)
	if m.Template == "" {
		email.SetBody(mail.TextHTML, m.Content)
	} else {
		templateName, err := ioutil.ReadFile(fmt.Sprintf("./email-template/%s", m.Template))
		if err != nil {
			appConfig.ErrorLog.Println(err)
		}
		emailTemplate := string(templateName)
		mailToSend := strings.Replace(emailTemplate, "[%mail_body%]", m.Content, 1)
		email.SetBody(mail.TextHTML, mailToSend)
	}

	err = email.Send(client)
	if err != nil {
		log.Println(err)
	} else {
		log.Println("Email sent!")
	}
}
