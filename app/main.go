package main

import (
	"fmt"
	"log"
	"net/http"
)

func main() {
	const portNumber = ":8082"
	// start application and connect to database
	err := StartApp()
	if err != nil {
		log.Fatal(err)
	}
	defer close(appConfig.MailChan)
	fmt.Println("starting sendmail listener...")
	sendMailListen()

	fmt.Println(fmt.Sprintf("Server is started on port %s", portNumber))
	fmt.Println("------------------------------------------------------------------------")
	fmt.Println("Current environment isProduction: ", appConfig.IsProduction)

	// Serve server service
	err = http.ListenAndServe(portNumber, routes(&appConfig))
	if err != nil {
		fmt.Println("------------------------------------------------------------------")
		fmt.Println(fmt.Sprintf(":( sorry can't start server on port %s ", portNumber))
		fmt.Println(fmt.Sprintf("error: %s", err))
		fmt.Println("------------------------------------------------------------------")
	}

}
