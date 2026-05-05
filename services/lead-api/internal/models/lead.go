package models

import "time"

type Lead struct {
	ID            string    `json:"id"`
	FullName      string    `json:"full_name"`
	Email         string    `json:"email"`
	Phone         *string   `json:"phone,omitempty"`
	Company       *string   `json:"company,omitempty"`
	PropertyName  *string   `json:"property_name,omitempty"`
	PropertyType  *string   `json:"property_type,omitempty"`
	Interest      []string  `json:"interest"`
	Message       string    `json:"message"`
	Source        string    `json:"source"`
	Status        string    `json:"status"`
	UTMSource     *string   `json:"utm_source,omitempty"`
	UTMMedium     *string   `json:"utm_medium,omitempty"`
	UTMCampaign   *string   `json:"utm_campaign,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}
