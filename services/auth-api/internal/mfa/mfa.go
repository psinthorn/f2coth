// Package mfa is a dependency-free TOTP (RFC 6238) implementation plus the
// helpers auth-api needs for multi-factor auth: base32 seed generation,
// AES-256-GCM encryption of the seed at rest, otpauth:// URIs for enrolment,
// and one-time recovery codes.
package mfa

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base32"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"net/url"
	"strings"
	"time"
)

const (
	period = 30 // seconds per TOTP step
	digits = 6
	skew   = 1 // accept the code from the previous/next step (clock drift)
)

var b32 = base32.StdEncoding.WithPadding(base32.NoPadding)

// GenerateSecret returns a fresh base32-encoded 20-byte TOTP seed.
func GenerateSecret() (string, error) {
	buf := make([]byte, 20)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return b32.EncodeToString(buf), nil
}

// code computes the TOTP for a base32 secret at a given step counter.
func code(secret string, counter uint64) (string, error) {
	key, err := b32.DecodeString(strings.ToUpper(strings.TrimSpace(secret)))
	if err != nil {
		return "", err
	}
	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], counter)
	h := hmac.New(sha1.New, key)
	h.Write(msg[:])
	sum := h.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	val := (uint32(sum[offset]&0x7f) << 24) | (uint32(sum[offset+1]) << 16) |
		(uint32(sum[offset+2]) << 8) | uint32(sum[offset+3])
	return fmt.Sprintf("%0*d", digits, val%1_000_000), nil
}

// Validate reports whether a 6-digit code matches the secret now (±1 step).
// Constant-time compare to avoid leaking timing on the code.
func Validate(secret, input string) bool {
	input = strings.TrimSpace(input)
	if len(input) != digits {
		return false
	}
	now := uint64(time.Now().Unix()) / period
	for d := -skew; d <= skew; d++ {
		c, err := code(secret, now+uint64(int64(d)))
		if err != nil {
			return false
		}
		if subtle.ConstantTimeCompare([]byte(c), []byte(input)) == 1 {
			return true
		}
	}
	return false
}

// OTPAuthURI builds the otpauth:// URI an authenticator app scans.
func OTPAuthURI(issuer, account, secret string) string {
	label := url.PathEscape(issuer + ":" + account)
	q := url.Values{}
	q.Set("secret", secret)
	q.Set("issuer", issuer)
	q.Set("algorithm", "SHA1")
	q.Set("digits", fmt.Sprintf("%d", digits))
	q.Set("period", fmt.Sprintf("%d", period))
	return "otpauth://totp/" + label + "?" + q.Encode()
}

// ── Encryption of the seed at rest (AES-256-GCM) ──

// Encrypt returns base64(nonce || ciphertext) for storage in mfa_secret.
func Encrypt(key [32]byte, plaintext string) (string, error) {
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	ct := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(ct), nil
}

// Decrypt reverses Encrypt.
func Decrypt(key [32]byte, encoded string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", fmt.Errorf("ciphertext too short")
	}
	nonce, ct := raw[:gcm.NonceSize()], raw[gcm.NonceSize():]
	pt, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return "", err
	}
	return string(pt), nil
}

// ── Recovery codes ──

// GenerateRecoveryCodes returns n human-friendly codes (e.g. "3F9K-A2QJ") plus
// their sha256 hex hashes (only the hashes are stored).
func GenerateRecoveryCodes(n int) (plain []string, hashes []string, err error) {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	for i := 0; i < n; i++ {
		buf := make([]byte, 8)
		if _, err = rand.Read(buf); err != nil {
			return nil, nil, err
		}
		var sb strings.Builder
		for j, b := range buf {
			if j == 4 {
				sb.WriteByte('-')
			}
			sb.WriteByte(alphabet[int(b)%len(alphabet)])
		}
		c := sb.String()
		plain = append(plain, c)
		hashes = append(hashes, HashRecovery(c))
	}
	return plain, hashes, nil
}

// HashRecovery normalises (upper, strip dashes/spaces) then sha256-hex hashes a
// recovery code, so stored hashes match regardless of how the user types it.
func HashRecovery(code string) string {
	norm := strings.ToUpper(strings.NewReplacer("-", "", " ", "").Replace(strings.TrimSpace(code)))
	sum := sha256.Sum256([]byte(norm))
	return hex.EncodeToString(sum[:])
}
