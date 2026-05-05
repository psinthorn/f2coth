package handlers

import "crypto/rand"

// cryptoRandRead is a tiny shim so handlers/auth.go can stay vendoring-free.
func cryptoRandRead(b []byte) (int, error) {
	return rand.Read(b)
}
