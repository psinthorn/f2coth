package domain

import "time"

// Room is the room model
type room struct {
	ID          int       `json: "id"`
	RoomTypeId  int       `json: "roomtype_id"`
	RoomName    string    `json: "room_name"`
	RoomNo      int       `json: "room_no"`
	Description string    `json: "description"`
	Status      string    `json: "status"`
	CreatedAt   time.Time `json: "created_at"`
	UpdatedAt   time.Time `json: "updated_at"`
	RoomType    RoomType  `json: "room_type"`
}
