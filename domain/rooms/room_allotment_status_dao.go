package domain

import (
	"context"
	"time"

	"github.com/psinthorn/f2coth/datasources/drivers"
)

const (
	queryInsertRoomAllotmentStatus = "INSERT INTO room_allotments (room_type_id, room_no_id, reservation_id, room_status_id, start_date, end_date, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id"
)

var RoomAllotmentStatusService roomAllotmentStatusInterface = &RoomAllotmentStatus{}

type RoomAllotmentStatus roomAllotmentStatus
type roomAllotmentStatusInterface interface {
	Creat(ram RoomAllotmentStatus) (int, error)
}

func (rm *RoomAllotmentStatus) Creat(ram RoomAllotmentStatus) (int, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	dbConn, err := drivers.ConnectDB("pgx", drivers.PgDsn)
	if err != nil {
		return 0, err
	}

	// execute insert command
	var newRoomAllotMentID int
	err = dbConn.SQL.QueryRowContext(ctx, queryInsertRoomAllotmentStatus,
		ram.RoomTypeID,
		ram.RoomNoID,
		ram.ReservationID,
		ram.RoomStatusID,
		ram.StartDate,
		ram.EndDate,
		ram.CreatedAt,
		ram.UpdatedAt).Scan(&newRoomAllotMentID)

	if err != nil {
		return 0, err
	}
	defer dbConn.SQL.Close()

	return newRoomAllotMentID, nil
}
