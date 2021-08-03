package domain

import "time"

type roomType struct {
	ID          int       `json: "id"`
	Title       string    `json: "title"`
	Description string    `json: "description"`
	Facility    string    `json: "facility"`
	Status      string    `json: "status"` // public, disable
	CreatedAt   time.Time `json: "created_at"`
	UpdatedAt   time.Time `json: "updated_at"`
}

type Facility struct{}
type Amenity struct{}
type Gallery struct{}
type RoomRate struct{}
