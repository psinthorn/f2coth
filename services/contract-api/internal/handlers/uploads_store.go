package handlers

// Volume-backed file storage for contract artifacts (generated docx/pdf and
// signed scans). Bytes live on the contract-uploads Docker volume, NEVER in
// Postgres — contract_files holds only metadata + the relative storage_path.
// Mirrors the checklist-api uploads.go SaveFile/OpenFile seam so swapping to
// S3 later means touching only this file.

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const maxContractFileBytes = 20 << 20 // 20 MiB per file

// saveBytes writes payload to the uploads volume under a random, non-guessable
// name with the given extension. Returns (storagePath, sha256Hex).
func (h *Handler) saveBytes(payload []byte, ext string) (string, string, error) {
	dir := h.uploadsDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", "", fmt.Errorf("uploads dir: %w", err)
	}
	name, err := randomName(ext)
	if err != nil {
		return "", "", err
	}
	dst := filepath.Join(dir, name)
	// Defensive path-traversal guard (random hex names never trigger it).
	if !strings.HasPrefix(filepath.Clean(dst), filepath.Clean(dir)+string(os.PathSeparator)) {
		return "", "", fmt.Errorf("bad path")
	}
	if err := os.WriteFile(dst, payload, 0o644); err != nil {
		return "", "", err
	}
	sum := sha256.Sum256(payload)
	return name, hex.EncodeToString(sum[:]), nil
}

// openStored opens a stored file by its storage_path (a bare name).
func (h *Handler) openStored(storagePath string) (*os.File, error) {
	if !safeStoredName(storagePath) {
		return nil, fmt.Errorf("bad stored name")
	}
	return os.Open(filepath.Join(h.uploadsDir(), storagePath))
}

func (h *Handler) uploadsDir() string {
	if h.UploadsDir != "" {
		return h.UploadsDir
	}
	if d := os.Getenv("UPLOADS_DIR"); d != "" {
		return d
	}
	return "/data/uploads"
}

func randomName(ext string) (string, error) {
	var buf [16]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "", err
	}
	if ext != "" && !strings.HasPrefix(ext, ".") {
		ext = "." + ext
	}
	return hex.EncodeToString(buf[:]) + ext, nil
}

// safeStoredName accepts 32 hex chars + dot + 1–4 lowercase-alpha extension.
func safeStoredName(s string) bool {
	if len(s) < 34 || len(s) > 40 {
		return false
	}
	dot := strings.LastIndexByte(s, '.')
	if dot != 32 {
		return false
	}
	for i := 0; i < 32; i++ {
		c := s[i]
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return false
		}
	}
	for i := dot + 1; i < len(s); i++ {
		c := s[i]
		if !(c >= 'a' && c <= 'z') {
			return false
		}
	}
	return true
}
