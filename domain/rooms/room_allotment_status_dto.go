package domain

import (
	"time"
)

// RoomRestrictions is the room restriction model
type roomAllotmentStatus struct {
	ID            int  `json: "id"`
	RoomTypeID    int  `json: "room_type_id"`
	RoomNoID      int  `json: "room_no_id"`
	ReservationID int  `json: "reservation_id"`
	RoomStatusID  int  `json: "room_status_id"`
	Room          Room `json: "room"`
	// Reservation   dbrepo.Reservation `json: "reservation"`
	StartDate time.Time `json: "start_date"`
	EndDate   time.Time `json: "end_date"`
	CreatedAt time.Time `json: "created_at"`
	UpdatedAt time.Time `json: "updated_at"`
}
