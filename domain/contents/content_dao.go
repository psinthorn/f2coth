package domain

import (
	"context"
	"time"

	"github.com/psinthorn/f2coth/datasources/drivers"
)

// import (
// 	mysql_db "github.com/psinthorn/gostack_users-api/datasources/mysql/users_db"
// 	"github.com/psinthorn/gostack_users-api/domains/errors"
// 	date_utils "github.com/psinthorn/gostack_users-api/utils/date"
// 	mysql_utils "github.com/psinthorn/gostack_users-api/utils/mysql"
// )

const (
	queryInsertContent     = "INSERT INTO contents(title, sub_title, content, content_type, category, image, tags, author, status, date_created) VALUES(?,?,?,?,?,?,?,?,?,?);"
	queryGetContentById    = "SELECT * FROM contents WHERE id = ?"
	queryDeleteContentById = "DELETE FROM contents where id = ?"
	queryGetAllContents    = "SELECT * FROM contents ORDER BY id DESC"
)

var (
	ContentService contentDomainInterface = &Content{}
)

type Content content
type contentDomainInterface interface {
	Create(ct Content) (int, error)
	GetAll() (Content, error)
}

var (
	contentDB = make(map[int64]*Content)
)

// ------------------------------------
// Create new content
func (c *Content) Create(ct Content) (int, error) {
	return 0, nil
}

// ------------------------------------
// Get All content by ID
func (c *Content) GetAll() (Content, error) {

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	db, err := drivers.ConnectDB("pgx", drivers.PgDsn)
	if err != nil {
		panic(err)
	}
	results, err := db.SQL.ExecContext(ctx, queryGetAllContents)
	if err != nil {
		panic(err)
	}

	results.LastInsertId()
	defer db.SQL.Close()

	// allContents := make([]Content, 0)
	// for results.Next(){
	// 	var content Content
	// 	err := results.SQL.Scan(&content.Id, &content.Title, &content.SubTitle, &content.Content, &content.ContentType, &content.Category, &content.Image, &content.Tags, &content.Author, &content.Status, &content.DateCreated)
	// 	if err != nil {
	// 		return nil, err
	// 	}
	// 	allContents = append(allContents, content)
	// }

	// if len(results) == 0 {
	// 	return nil, errors.NewNotFoundError("No content found")
	// }
	return Content{}, nil

}

// //
// // Get content by ID
// //
// func (content *Content) Get() error {

// 	// prepare statment
// 	stmt, err := mysql_db.Client.Prepare(queryGetContentById)
// 	// if error handle it
// 	if err != nil {
// 		return mysql_utils.PareError(err)
// 	}

// 	// Close statment protect run out connection
// 	defer stmt.Close()

// 	result := stmt.QueryRow(content.Id)
// 	if err := result.Scan(&content.Id, &content.Title, &content.SubTitle, &content.Content, &content.ContentType, &content.Category, &content.Image, &content.Tags, &content.Author, &content.Status, &content.DateCreated); err != nil {
// 		return mysql_utils.PareError(err)
// 	}

// 	return nil
// }

// //
// // Create new content
// //

// func (content *Content) Save() error {
// 	stmt, err := mysql_db.Client.Prepare(queryInsertContent)
// 	if err != nil {
// 		mysql_utils.PareError(err)
// 	}

// 	// Close statment protect run out connection
// 	defer stmt.Close()

// 	content.DateCreated = date_utils.GetNowString()
// 	result, err := stmt.Exec(content.Title, content.SubTitle, content.Content, content.ContentType, content.Category, content.Image, content.Tags, content.Author, content.Status, content.DateCreated)
// 	if err != nil {
// 		mysql_utils.PareError(err)
// 	}

// 	contentId, err := result.LastInsertId()
// 	if err != nil {
// 		mysql_utils.PareError(err)
// 	}
// 	content.Id = contentId
// 	return nil
// }

// func (content *Content) Delete() error {
// 	stmt, err := mysql_db.Client.Prepare(queryDeleteContentById)
// 	if err != nil {
// 		mysql_utils.PareError(err)
// 	}
// 	defer stmt.Close()

// 	_, err = stmt.Exec(content.Id)
// 	if err != nil {
// 		return mysql_utils.PareError(err)
// 	}

// 	return nil

// }
