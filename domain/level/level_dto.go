package domain

import "time"

type level struct {
	ID        int       `json: "id"`
	Title     string    `json: "title"`
	Status    string    `json: "status"`
	CreatedAt time.Time `json: "created_at"`
	UpdatedAt time.Time `json: "updated_at"`
}
