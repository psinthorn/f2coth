package domain_reservation

import (
	"time"

	domain "github.com/psinthorn/go_smallsite/domain/rooms"
)

// Reservations is the reservation model
type reservation struct {
	ID           int             `json: "id"`
	FirstName    string          `json: "first_name"`
	LastName     string          `json: "last_name"`
	Email        string          `json: "email"`
	Phone        string          `json: "phone"`
	RoomID       int             `json: "room_id"`
	RoomNo       int             `json: "room_no"`
	RoomTypeID   int             `json: "room_type_id"`
	RoomTypeName string          `json: "roomtype_name"`
	Status       string          `json: "status"` // available, stay, clean, maintenance
	StartDate    time.Time       `json: "start_date"`
	EndDate      time.Time       `json: "end_date"`
	CreatedAt    time.Time       `json: "created_at"`
	UpdatedAt    time.Time       `json: "updated_at"`
	Room         domain.Room     `json: "room"`
	RoomType     domain.RoomType `json: "room_type"`
	Processed    int             `json: "processed"`
}
