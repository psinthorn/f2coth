package domain

import (
	"context"
	"time"

	"github.com/psinthorn/go_smallsite/datasources/drivers"
)

const (
	queryInsertRoom  = "insert into rooms (roomtype_id, room_name, room_no, description, status, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7) returning id"
	queryGetAllRooms = `select rm.id, rm.roomtype_id, rm.room_name, rm.room_no, rm.description, rm.status, rm.created_at, rm.updated_at, rt.id, rt.title 
						from rooms rm 
						left join room_types rt 
						on (rm.roomtype_id = rt.id)
						order by rt.title asc
						`
	queryGetRoomByID = `SELECT id, roomtype_id, room_name, room_no, description, status, created_at, updated_at FROM rooms WHERE id = $1`
)

var RoomService roomDomainInterface = &Room{}

type Room room
type roomDomainInterface interface {
	Create(Room) (int, error)
	Get() ([]Room, error)
	GetRoomByID(int) (Room, error)
	Update(Room) (Room, error)
	Delete(int) error
}

// Create insert and return room data
// เพิ่มข้อมมูลห้องพักเก็บในดาต้าเบสและคืนข้อมูลที่เพิ่มสำเร็จแล้วกลับให้ผู้ใช้งาน
func (s *Room) Create(room Room) (int, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	dbConn, err := drivers.ConnectDB("pgx", drivers.PgDsn)
	if err != nil {
		panic(err)
	}

	var newRoomId int
	err = dbConn.SQL.QueryRowContext(ctx, queryInsertRoom, room.RoomTypeId, room.RoomName, room.RoomNo, room.Description, room.Status, room.CreatedAt, room.UpdatedAt).Scan(&newRoomId)
	if err != nil {
		return 0, err
	}
	defer dbConn.SQL.Close()
	return newRoomId, err
}

// Get Return all rooms slice
func (s *Room) Get() ([]Room, error) {
	var rooms []Room
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	dbConn, err := drivers.ConnectDB("pgx", drivers.PgDsn)
	if err != nil {
		return rooms, err
	}

	rows, err := dbConn.SQL.QueryContext(ctx, queryGetAllRooms)
	if err != nil {
		return rooms, err
	}
	defer rows.Close()

	for rows.Next() {
		var r Room
		err := rows.Scan(
			&r.ID,
			&r.RoomTypeId,
			&r.RoomName,
			&r.RoomNo,
			&r.Description,
			&r.Status,
			&r.CreatedAt,
			&r.UpdatedAt,
			&r.RoomType.ID,
			&r.RoomType.Title,
		)

		if err != nil {
			return rooms, err
		}

		rooms = append(rooms, r)
	}

	if err = rows.Err(); err != nil {
		return rooms, err
	}

	return rooms, nil

}

// GetRoomByID return room details
func (s *Room) GetRoomByID(id int) (Room, error) {

	var roombyId Room
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	dbConn, err := drivers.ConnectDB("pgx", drivers.PgDsn)
	if err != nil {
		return roombyId, err
	}

	err = dbConn.SQL.QueryRowContext(ctx, queryGetRoomByID, id).Scan(
		&roombyId.ID,
		&roombyId.RoomTypeId,
		&roombyId.RoomName,
		&roombyId.RoomNo,
		&roombyId.Description,
		&roombyId.Status,
		&roombyId.CreatedAt,
		&roombyId.UpdatedAt,
	)
	if err != nil {
		return roombyId, err
	}
	defer dbConn.SQL.Close()

	return roombyId, nil

}

func (s *Room) Update(r Room) (Room, error) {
	var room Room

	return room, nil
}

func (s *Room) Delete(id int) error {

	return nil
}
