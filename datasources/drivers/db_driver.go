package drivers

// Driver multi database connection function you just need to provide database drivers name and database source name (dns) to function parameter
// package drivers เป็นตัวช่วยในการเชื่อมต่อกับฐานข้อมูล โดยเพีบงจัดเตรียม driver และ DSN สำหรับฐานข้อมูที่ต้องการจะเชื่อมต่อเท่านั้น

import (
	"database/sql"
	"time"

	_ "github.com/jackc/pgconn"
	_ "github.com/jackc/pgx/v4"
	_ "github.com/jackc/pgx/v4/stdlib"
)

var (
	postgresDsn = "host=localhost port=5432 dbname=f2coth user=postgres password="
)

// DB to holds and store SLQ driver after we make database connection success
var Conn = &DbConn{}

type DbConn struct {
	SQL *sql.DB
}

const (
	maxDBConn     = 10
	maxDBIdleConn = 5
	maxDBLifeTime = 5 * time.Minute

	dsn = "host=localhost port=5432 dbname=go_smallsite_bookings user=postgres password="
)

// func init() {
// 	// Connect to postgress databast
// 	fmt.Println("Connecting to Database...")

// 	DbClient, err := sql.Open("pgx", dsn)
// 	if err != nil {
// 		panic(err)
// 	}
// 	if err = DbClient.Ping(); err != nil {
// 		panic(err)
// 	}
// 	fmt.Println("Connecting to Database Success fully :)")
// }

// Connect database by specify driver this will pass to Newdatabase function
// driver is depend on what is your database like postgres driver = "pgx"
func ConnectDB(driver, dsn string) (*DbConn, error) {
	db, err := NewDatabase(driver, dsn)
	if err != nil {
		panic(err)
	}

	db.SetMaxOpenConns(maxDBConn)
	db.SetMaxIdleConns(maxDBIdleConn)
	db.SetConnMaxLifetime(maxDBLifeTime)

	Conn.SQL = db

	err = testDB(db)
	if err != nil {
		return nil, err
	}

	return Conn, nil
}

// Newdatabase to create new database connecttion by specify database driver
// driver is depend on what is your database like postgres driver = "pgx" mysql = "mysql"
func NewDatabase(driver, dsn string) (*sql.DB, error) {
	// create connection to database by using
	db, err := sql.Open(driver, dsn)
	if err != nil {
		return nil, err
	}

	if err = db.Ping(); err != nil {
		return nil, err
	}

	return db, nil
}

// testDB is tries to ping database for connection testing
func testDB(db *sql.DB) error {
	err := db.Ping()
	if err != nil {
		return err
	}

	return nil
}
