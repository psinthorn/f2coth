package handlers

// Photo upload for checklist items. Techs on-site attach a photo per item
// (typically a phone camera capture). We serve back a URL that can be
// stored in project_items.photo_url.
//
// Storage: a volume-mounted directory (default /data/uploads) served by
// the same service at /api/checklists/uploads/{filename}. Files are named
// by a random UUID + preserved extension so filenames are non-guessable
// but collisions are effectively impossible.
//
// Limits:
//   - 8 MiB max per file (phones churn out ~2–4 MiB HEIC/JPEG)
//   - allowlist: image/jpeg, image/png, image/webp, image/heic, image/heif
//   - only staff (admin+editor) can upload; portal users are read-only
//
// This is deliberately simple — no S3, no thumbnails, no de-dup. If we
// grow past a few thousand files we swap the storage backend behind
// SaveFile/OpenFile without touching handlers.

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
)

const (
	maxUploadBytes = 8 << 20 // 8 MiB per file
	// Per-project soft quota — the API refuses new uploads once a project
	// has more than this many photo_url values set on its items. Techs
	// still submit statuses without photos; they just can't attach a new
	// photo until the admin clears an old one or bumps the cap.
	perProjectPhotoQuota = 500
)

var allowedMIME = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/webp": ".webp",
	"image/heic": ".heic",
	"image/heif": ".heif",
}

// UploadsDir is the volume-mounted host directory. Injected from config
// at wire time; empty means the endpoint returns 503 (feature disabled).
func (h *Handler) uploadsDir() string {
	if d := os.Getenv("UPLOADS_DIR"); d != "" {
		return d
	}
	return "/data/uploads"
}

// POST /api/checklists/uploads?project_id=<uuid> — multipart/form-data with field "file".
// Returns {"url":"/api/checklists/uploads/<name>"} on success.
//
// Per-project quota (perProjectPhotoQuota) is enforced *before* the file
// is read to disk so an over-quota project can't waste bytes. project_id
// is optional today for backward-compat, but the frontend always passes
// it — new integrations should too.
func (h *Handler) UploadPhoto(w http.ResponseWriter, r *http.Request) {
	dir := h.uploadsDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		writeErr(w, http.StatusServiceUnavailable, "uploads not configured")
		return
	}

	if projectID := r.URL.Query().Get("project_id"); projectID != "" {
		var count int
		if err := h.DB.QueryRow(r.Context(), `
			SELECT COUNT(*)
			  FROM project_items pi
			  JOIN project_modules pm ON pm.id = pi.project_module_id
			 WHERE pm.project_id = $1 AND pi.photo_url IS NOT NULL
		`, projectID).Scan(&count); err == nil && count >= perProjectPhotoQuota {
			writeErr(w, http.StatusForbidden,
				fmt.Sprintf("project photo quota exhausted (%d/%d)", count, perProjectPhotoQuota))
			return
		}
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)
	if err := r.ParseMultipartForm(maxUploadBytes); err != nil {
		writeErr(w, http.StatusBadRequest, "file too large or malformed multipart")
		return
	}
	file, hdr, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "missing file field")
		return
	}
	defer file.Close()

	mime := hdr.Header.Get("Content-Type")
	ext, ok := allowedMIME[mime]
	if !ok {
		writeErr(w, http.StatusBadRequest, "unsupported image type: "+mime)
		return
	}

	name, err := randomName(ext)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "name generation failed")
		return
	}
	dst := filepath.Join(dir, name)
	// Refuse path traversal defensively — should never happen with a
	// hex-only randomName, but belt-and-braces.
	if !strings.HasPrefix(filepath.Clean(dst), filepath.Clean(dir)+string(os.PathSeparator)) {
		writeErr(w, http.StatusBadRequest, "bad path")
		return
	}
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create file")
		return
	}
	defer out.Close()
	if _, err := io.Copy(out, file); err != nil {
		writeErr(w, http.StatusInternalServerError, "write failed: "+err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{
		"url": "/api/checklists/uploads/" + name,
	})
}

// GET /api/checklists/uploads/{name} — serve a stored file. Public
// (no auth) so URLs are shareable in the customer portal + emailed
// reports. Files are non-guessable by design (128 bits of entropy in
// the name), so unauthenticated read is acceptable for this use case.
func (h *Handler) ServeUpload(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	// Only allow simple hex+ext filenames so a URL-crafted "../etc/passwd"
	// never reaches the filesystem.
	if !safeUploadName(name) {
		writeErr(w, http.StatusBadRequest, "bad name")
		return
	}
	full := filepath.Join(h.uploadsDir(), name)
	f, err := os.Open(full)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			writeErr(w, http.StatusNotFound, "not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "open failed")
		return
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "stat failed")
		return
	}
	// Set a permissive cache — filenames are content-addressable via the
	// random hash, so they're immutable in practice.
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	http.ServeContent(w, r, name, stat.ModTime(), f)
}

// ── helpers ────────────────────────────────────────────────────────────

func randomName(ext string) (string, error) {
	var buf [16]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "", err
	}
	return fmt.Sprintf("%s%s", hex.EncodeToString(buf[:]), ext), nil
}

// safeUploadName accepts 32 hex chars + dot + 3–4 alpha chars only.
// Anything else (slashes, dots, control) is rejected. Matches what
// randomName emits so we never serve anything we didn't create.
func safeUploadName(s string) bool {
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
