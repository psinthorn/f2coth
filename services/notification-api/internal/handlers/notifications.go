package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/smtp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/f2cothai/f2-website/services/notification-api/internal/config"

	b64pkg "encoding/base64"
)

// _b64 is the shared base64 encoder for MIME assembly + RFC2047 subject
// encoding. Kept package-private so the helper code reads cleanly.
var _b64 = b64pkg.StdEncoding

type NotificationHandler struct {
	DB  *pgxpool.Pool
	Cfg config.Config
}

type enqueueReq struct {
	Channel       string         `json:"channel"`
	Template      string         `json:"template"`
	ToAddress     string         `json:"to_address"`
	CCAddress     string         `json:"cc_address"`
	BCCAddress    string         `json:"bcc_address"`
	Subject       string         `json:"subject"`
	Payload       map[string]any `json:"payload"`
	RelatedLeadID string         `json:"related_lead_id"`
	Locale        string         `json:"locale"` // "en" | "th"; default en
	// Attachments piggy-back on `payload._attachments` so we don't need
	// a schema migration to ship this. Each attachment is base64-encoded
	// in the producer (payment-api PDF renderer); the worker decodes it
	// and assembles a multipart/mixed MIME body.
}

type emailAttachment struct {
	Filename    string `json:"filename"`
	ContentType string `json:"content_type"`
	ContentB64  string `json:"content_b64"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func normaliseLocale(in string) string {
	switch strings.ToLower(strings.TrimSpace(in)) {
	case "th":
		return "th"
	default:
		return "en"
	}
}

func (h *NotificationHandler) Enqueue(w http.ResponseWriter, r *http.Request) {
	var req enqueueReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Channel == "" {
		req.Channel = "email"
	}
	if req.Template == "" || req.ToAddress == "" {
		writeErr(w, http.StatusBadRequest, "template and to_address required")
		return
	}
	loc := normaliseLocale(req.Locale)
	payload, _ := json.Marshal(req.Payload)

	var id string
	err := h.DB.QueryRow(r.Context(), `
        INSERT INTO notifications (channel, template, to_address, cc_address, bcc_address,
                                   subject, payload, related_lead_id, locale)
        VALUES ($1,$2,$3,NULLIF($4,''),NULLIF($5,''),NULLIF($6,''),$7,NULLIF($8,'')::uuid,$9)
        RETURNING id
    `, req.Channel, req.Template, req.ToAddress, req.CCAddress, req.BCCAddress,
		req.Subject, payload, req.RelatedLeadID, loc).Scan(&id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not enqueue")
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"id": id, "status": "queued"})
}

// ----- Worker -----

func (h *NotificationHandler) StartWorker(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.drainOnce(ctx)
		}
	}
}

func (h *NotificationHandler) drainOnce(ctx context.Context) {
	rows, err := h.DB.Query(ctx, `
        SELECT id, channel, template, to_address, cc_address, bcc_address,
               COALESCE(subject,''), payload, attempts, locale
        FROM notifications
        WHERE status = 'queued' AND scheduled_at <= NOW()
        ORDER BY created_at ASC LIMIT 25
    `)
	if err != nil {
		log.Printf("drain query: %v", err)
		return
	}
	defer rows.Close()

	type job struct {
		id       string
		channel  string
		template string
		to       string
		cc       *string
		bcc      *string
		subject  string
		payload  []byte
		attempts int
		locale   string
	}
	var jobs []job
	for rows.Next() {
		var j job
		if err := rows.Scan(&j.id, &j.channel, &j.template, &j.to, &j.cc, &j.bcc,
			&j.subject, &j.payload, &j.attempts, &j.locale); err != nil {
			log.Printf("drain scan: %v", err)
			continue
		}
		jobs = append(jobs, j)
	}

	for _, j := range jobs {
		_, _ = h.DB.Exec(ctx,
			`UPDATE notifications SET status='sending', attempts=attempts+1 WHERE id=$1`, j.id)

		err := h.deliver(ctx, j.channel, j.template, j.to, j.subject, j.payload, j.locale)
		if err != nil {
			final := "queued"
			if j.attempts+1 >= 5 {
				final = "dead"
			}
			_, _ = h.DB.Exec(ctx, `
                UPDATE notifications SET status=$2, last_error=$3 WHERE id=$1
            `, j.id, final, err.Error())
			log.Printf("notification %s failed: %v", j.id, err)
			continue
		}
		_, _ = h.DB.Exec(ctx, `
            UPDATE notifications SET status='sent', sent_at=NOW(), last_error=NULL WHERE id=$1
        `, j.id)
	}
}

func (h *NotificationHandler) deliver(ctx context.Context, channel, template, to, subject string, payload []byte, locale string) error {
	if channel != "email" {
		return fmt.Errorf("channel %q not supported", channel)
	}
	// Resolve SMTP from DB (with env fallback) so admin edits take effect
	// without redeploying. See smtp_admin.go for the resolution rules.
	s := h.resolveSMTP(ctx)
	if s.Host == "" {
		return fmt.Errorf("SMTP not configured")
	}

	subjTmpl, bodyTmpl, err := h.loadTemplate(ctx, template, locale)
	if err != nil {
		return err
	}
	if subject == "" {
		subject = subjTmpl
	}

	var data map[string]any
	_ = json.Unmarshal(payload, &data)

	// Pull out attachments before rendering so they don't leak into
	// the template substitutions as visible "{{_attachments}}" leftovers.
	atts := extractAttachments(data)

	subject = renderTemplate(subject, data)
	body := renderTemplate(bodyTmpl, data)

	msg := buildEmail(s.FromAddress, to, subject, body, atts)
	addr := fmt.Sprintf("%s:%d", s.Host, s.Port)
	var auth smtp.Auth
	if s.Username != "" {
		auth = smtp.PlainAuth("", s.Username, s.Password, s.Host)
	}
	return smtp.SendMail(addr, auth, s.Username, []string{to}, msg)
}

// extractAttachments lifts the `_attachments` array out of the payload
// map (if present) and decodes each into the in-memory shape the email
// builder needs. The key is deliberately underscore-prefixed so it
// can't collide with a real template variable.
func extractAttachments(data map[string]any) []emailAttachment {
	if data == nil {
		return nil
	}
	raw, ok := data["_attachments"]
	if !ok {
		return nil
	}
	delete(data, "_attachments")
	list, ok := raw.([]any)
	if !ok {
		return nil
	}
	out := make([]emailAttachment, 0, len(list))
	for _, item := range list {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		out = append(out, emailAttachment{
			Filename:    asString(m["filename"]),
			ContentType: asString(m["content_type"]),
			ContentB64:  asString(m["content_b64"]),
		})
	}
	return out
}

func asString(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

// loadTemplate resolves the locale-aware variant of the template, with
// COALESCE-style fallback to English. The DB CHECK constraint guarantees
// `en` is always present, so the second argument can never be NULL.
func (h *NotificationHandler) loadTemplate(ctx context.Context, code, locale string) (subj, body string, err error) {
	if locale == "" {
		locale = "en"
	}
	err = h.DB.QueryRow(ctx, `
        SELECT COALESCE(subject_tmpl->>$2, subject_tmpl->>'en'),
               COALESCE(body_tmpl->>$2,    body_tmpl->>'en')
        FROM notification_templates
        WHERE code = $1 AND is_active = TRUE
    `, code, locale).Scan(&subj, &body)
	return
}

func renderTemplate(s string, data map[string]any) string {
	for k, v := range data {
		s = strings.ReplaceAll(s, "{{"+k+"}}", fmt.Sprintf("%v", v))
	}
	return s
}

// buildEmail emits a single-part text/plain message when there are no
// attachments, or a multipart/mixed message wrapping the body + each
// attachment otherwise. The boundary is fixed at "f2-mime-boundary" —
// good enough since the chance of that exact string occurring in the
// body or attachment content is astronomically low.
func buildEmail(from, to, subject, body string, atts []emailAttachment) []byte {
	var b strings.Builder
	fmt.Fprintf(&b, "From: %s\r\n", from)
	fmt.Fprintf(&b, "To: %s\r\n", to)
	fmt.Fprintf(&b, "Subject: %s\r\n", encodeRFC2047(subject))
	b.WriteString("MIME-Version: 1.0\r\n")

	if len(atts) == 0 {
		b.WriteString("Content-Type: text/plain; charset=\"utf-8\"\r\n")
		b.WriteString("Content-Transfer-Encoding: 8bit\r\n")
		b.WriteString("\r\n")
		b.WriteString(body)
		return []byte(b.String())
	}

	const boundary = "f2-mime-boundary"
	fmt.Fprintf(&b, "Content-Type: multipart/mixed; boundary=%q\r\n\r\n", boundary)

	// Body part
	fmt.Fprintf(&b, "--%s\r\n", boundary)
	b.WriteString("Content-Type: text/plain; charset=\"utf-8\"\r\n")
	b.WriteString("Content-Transfer-Encoding: 8bit\r\n\r\n")
	b.WriteString(body)
	b.WriteString("\r\n")

	// Attachments (base64-encoded payload streamed through verbatim —
	// payment-api already encoded; we just wrap it in MIME headers).
	for _, a := range atts {
		if a.Filename == "" || a.ContentB64 == "" {
			continue
		}
		ct := a.ContentType
		if ct == "" {
			ct = "application/octet-stream"
		}
		fmt.Fprintf(&b, "--%s\r\n", boundary)
		fmt.Fprintf(&b, "Content-Type: %s; name=%q\r\n", ct, a.Filename)
		b.WriteString("Content-Transfer-Encoding: base64\r\n")
		fmt.Fprintf(&b, "Content-Disposition: attachment; filename=%q\r\n\r\n", a.Filename)
		// Re-flow to 76-char lines per RFC 2045.
		b.WriteString(reflow(a.ContentB64, 76))
		b.WriteString("\r\n")
	}

	fmt.Fprintf(&b, "--%s--\r\n", boundary)
	return []byte(b.String())
}

// encodeRFC2047 wraps non-ASCII subjects so SMTP clients render Thai
// chars correctly. We always encode — the cost is small and it side-
// steps "should I" predicates.
func encodeRFC2047(s string) string {
	for _, r := range s {
		if r > 127 {
			return "=?utf-8?B?" + base64StdString(s) + "?="
		}
	}
	return s
}

func base64StdString(s string) string {
	// import "encoding/base64" already used elsewhere in this package;
	// dropping the import in inline closures would duplicate. Reuse via
	// the var below.
	return _b64.EncodeToString([]byte(s))
}

func reflow(s string, n int) string {
	if n <= 0 || len(s) <= n {
		return s
	}
	var b strings.Builder
	for i := 0; i < len(s); i += n {
		end := i + n
		if end > len(s) {
			end = len(s)
		}
		b.WriteString(s[i:end])
		b.WriteString("\r\n")
	}
	return b.String()
}
