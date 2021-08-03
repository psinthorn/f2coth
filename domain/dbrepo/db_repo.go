package dbrepo

import (
	"database/sql"

	"github.com/psinthorn/f2coth/configs"
)

type sqlDbRepo struct {
	App *configs.AppConfig
	DB  *sql.DB
}

// NewDBRepo will hold database connection pool and app configs
// func NewDBConnectRepo(ac *configs.AppConfig, conn *sql.DB) interface{} {
func NewDBConnectRepo(ac *configs.AppConfig, conn *sql.DB) interface{} {
	return &sqlDbRepo{
		App: ac,
		DB:  conn,
	}
}
