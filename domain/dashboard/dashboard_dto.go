type dashboard struct {
	ID	int	`json: "id"`,
	Reservations int `json: "reservations"`
	Bookings	int `json: "booking"`,
	Revenue	int `json: "revenue"`,
	Users int 	`json: "users"`
}