package utils

import (
	"fmt"
	"os"

	"github.com/psinthorn/go_smallsite/configs"
)

// // Utils is use for public utilities method
// var (
// 	Utils u
// )

// type utils struct{}

// IsProduction func is check local env return true or false
func (u *Utils) IsProduction(appConfig *configs.AppConfig) {
	// Add logic to check env that is dev or prod
	hostName, _ := os.Hostname()
	var isProduction bool

	fmt.Println("------------------------------------------------------------------------")
	fmt.Println("Current Host name is: ", hostName)
	fmt.Println("------------------------------------------------------------------------")

	// if hostName == "psinthorn-macbook.local" {
	if hostName != "" {
		isProduction = false
	} else {
		isProduction = true
	}

	appConfig.IsProduction = isProduction
	return
}
