package domain

import (
	"context"
	"time"

	"github.com/psinthorn/f2coth/datasources/drivers"
)

const (
	queryInsertRoomType  = `INSERT INTO room_types (title, description, status, created_at, updated_at) values ($1,$2,$3,$4,$5) returning id`
	querygetRoomtypeByID = `select id, title from room_types where id = $1`
)

var RoomTypeService roomTypeInterface = &RoomType{}

type RoomType roomType
type roomTypeInterface interface {
	Create(RoomType) (int, error)
	GetRoomTypeByID(id int) (RoomType, error)
}

func (rs *RoomType) Create(r RoomType) (int, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	dbConn, err := drivers.ConnectDB("pgx", drivers.PgDsn)
	if err != nil {
		panic(err)
	}

	var newRoomTypeID int
	err = dbConn.SQL.QueryRowContext(ctx, queryInsertRoomType, r.Title, r.Description, r.Status, r.CreatedAt, r.UpdatedAt).Scan(&newRoomTypeID)
	if err != nil {
		return 0, nil
	}
	defer dbConn.SQL.Close()

	return newRoomTypeID, nil
}

func (rs *RoomType) GetAll() {}

// GetRoomeTypeByID
func (rs *RoomType) GetRoomTypeByID(id int) (RoomType, error) {

	var roomType RoomType
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	dbConn, err := drivers.ConnectDB("pgx", drivers.PgDsn)
	if err != nil {
		panic(err)
	}

	err = dbConn.SQL.QueryRowContext(ctx, querygetRoomtypeByID, id).Scan(&roomType.ID, &roomType.Title)
	if err != nil {
		return roomType, err
	}
	defer dbConn.SQL.Close()

	return roomType, nil
}

func (rs *RoomType) Update() {}

func (rs *RoomType) Delete() {}
