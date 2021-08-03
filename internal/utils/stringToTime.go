package utils

import (
	"time"
)

func (m *Utils) StringToTime(timeString string) (time.Time, error) {

	// Date time layout
	// startDate.Format("2006-01-02 15:04:05")
	dateLayout := "2006-01-02"
	timeTime, err := time.Parse(dateLayout, timeString)
	if err != nil {
		return time.Time{}, err
	}
	return timeTime, nil
}
