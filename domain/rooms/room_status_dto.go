package domain

import "time"

// Status is the room status  model
type roomStatus struct {
	ID          int       `json: "id"`
	Title       string    `json: "status_name"`
	Symbol      string    `json: "symbol"` // Short for title
	Description string    `json: "description"`
	Status      string    `json: "status"` // publish, unpublish
	CreatedAt   time.Time `json: "created_at"`
	UpdatedAt   time.Time `json: "updated_at"`
}
