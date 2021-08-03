package domain_reservation

import (
	"context"
	"fmt"
	"time"

	"github.com/psinthorn/f2coth/datasources/drivers"
	domain "github.com/psinthorn/f2coth/domain/rooms"
)

const (
	queryInsertReservation = `insert into reservations (first_name, last_name, email, phone, room_id, status, start_date, end_date, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`
	querySelectAllRsvn     = `SELECT r.id, r.first_name, r.last_name, r.email, r.phone, r.room_id, r.status, r.start_date, r.end_date, r.created_at, r.updated_at, rt.id, rt.title, r.processed
										FROM reservations r 
										left join room_types rt 
										on (r.room_id = rt.id) 
										order by r.start_date desc`
	queryGetRsvnById               = `SELECT * FROM reservations r WHERE id = $1`
	querySearchAvailability        = `SELECT count(id) FROM room_allotments WHERE room_no_id = $1 AND $2 < end_date AND $3 > start_date`
	querySearchAvailabilityAllRoom = `SELECT r.id, r.roomtype_id, r.room_no FROM rooms r WHERE r.id not in (SELECT ra.room_no_id FROM room_allotments ra WHERE $1 < ra.end_date AND $2 > ra.start_date)`
)

var ReservationService reservationDomainInterface = &Reservation{}

type Reservation reservation
type reservationDomainInterface interface {
	Create(Reservation) (int, error)
	GetAll() ([]Reservation, error)
	GetByID(int) (Reservation, error)
	Update(int) (Reservation, error)
	Delete(int) error

	SearchAvailabilityByRoomId(roomID int, start, end time.Time) (bool, error)
	SearchAvailabilityAllRoom(start, end time.Time) ([]domain.Room, error)
}

// PostReservation is reservation page render
func (r *Reservation) Create(rsvn Reservation) (int, error) {

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	dbConn, err := drivers.ConnectDB("pgx", drivers.PgDsn)
	if err != nil {
		panic(err)
	}
	var newReservationId int
	err = dbConn.SQL.QueryRowContext(ctx, queryInsertReservation, rsvn.FirstName, rsvn.LastName, rsvn.Email, rsvn.Phone, rsvn.RoomID, rsvn.RoomTypeName, rsvn.Status, rsvn.StartDate, rsvn.EndDate, rsvn.CreatedAt, rsvn.UpdatedAt).Scan(&newReservationId)
	if err != nil {
		return 0, err
	}
	defer dbConn.SQL.Close()

	return newReservationId, nil

}

// GetAll retrun a slice of reservations
func (r *Reservation) GetAll() ([]Reservation, error) {
	ctx, cancle := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancle()

	var rsvns []Reservation
	dbConn, err := drivers.ConnectDB("pgx", drivers.PgDsn)
	if err != nil {
		return rsvns, err
	}
	rows, err := dbConn.SQL.QueryContext(ctx, querySelectAllRsvn)
	if err != nil {
		return rsvns, err
	}
	defer rows.Close()

	for rows.Next() {
		var rs Reservation
		err := rows.Scan(
			&rs.ID,
			&rs.FirstName,
			&rs.LastName,
			&rs.Email,
			&rs.Phone,
			&rs.RoomID,
			&rs.Status,
			&rs.StartDate,
			&rs.EndDate,
			&rs.CreatedAt,
			&rs.UpdatedAt,
			&rs.RoomType.ID,
			&rs.RoomType.Title,
			&rs.Processed,
		)

		if err != nil {
			return rsvns, err
		}
		rsvns = append(rsvns, rs)
	}

	if err = rows.Err(); err != nil {
		return rsvns, err
	}

	return rsvns, nil
}

func (r *Reservation) GetByID(id int) (Reservation, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	var rsvn Reservation
	dbConn, err := drivers.ConnectDB("pgx", drivers.PgDsn)
	if err != nil {
		return rsvn, err
	}

	row := dbConn.SQL.QueryRowContext(ctx, queryGetRsvnById, id)
	//defer row()
	row.Scan(
		&rsvn.ID,
		&rsvn.FirstName,
		&rsvn.LastName,
	)

	return rsvn, nil
}
func (r *Reservation) Update(id int) (Reservation, error) {
	return Reservation{}, nil
}
func (r *Reservation) Delete(id int) error {
	return nil
}

// CheckAvailabilityByRoomId return available room of give room id with given dates
func (r *Reservation) SearchAvailabilityByRoomId(roomID int, start, end time.Time) (bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	dbConn, err := drivers.ConnectDB("pgx", drivers.PgDsn)
	if err != nil {
		return false, err
	}

	var numRows int
	row := dbConn.SQL.QueryRowContext(ctx, querySearchAvailability, roomID, start, end)
	err = row.Scan(&numRows)
	if err != nil {
		return false, err
	}

	fmt.Println("numRows", numRows)

	if numRows == 0 {
		return true, nil
	}

	defer dbConn.SQL.Close()
	return false, nil

}

// SearchCheckAvailabilityAllRoom return a slice of available rooms for given date range
func (r *Reservation) SearchAvailabilityAllRoom(startDate, endDate time.Time) ([]domain.Room, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	dbConn, err := drivers.ConnectDB("pgx", drivers.PgDsn)
	if err != nil {
		return nil, err
	}

	var availableRooms []domain.Room
	rows, err := dbConn.SQL.QueryContext(ctx, querySearchAvailabilityAllRoom, startDate, endDate)

	for rows.Next() {
		var room domain.Room
		err := rows.Scan(
			&room.ID,
			&room.RoomTypeId,
			&room.RoomNo,
		)
		if err != nil {
			return nil, err
		}
		availableRooms = append(availableRooms, room)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}

	defer dbConn.SQL.Close()
	return availableRooms, nil

}
