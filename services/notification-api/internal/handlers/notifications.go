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
)

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
	if h.Cfg.SMTPHost == "" {
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

	subject = renderTemplate(subject, data)
	body := renderTemplate(bodyTmpl, data)

	msg := buildEmail(h.Cfg.SMTPFrom, to, subject, body)
	addr := fmt.Sprintf("%s:%d", h.Cfg.SMTPHost, h.Cfg.SMTPPort)
	auth := smtp.PlainAuth("", h.Cfg.SMTPUser, h.Cfg.SMTPPassword, h.Cfg.SMTPHost)
	return smtp.SendMail(addr, auth, h.Cfg.SMTPUser, []string{to}, msg)
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

func buildEmail(from, to, subject, body string) []byte {
	var b strings.Builder
	fmt.Fprintf(&b, "From: %s\r\n", from)
	fmt.Fprintf(&b, "To: %s\r\n", to)
	fmt.Fprintf(&b, "Subject: %s\r\n", subject)
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: text/plain; charset=\"utf-8\"\r\n")
	b.WriteString("\r\n")
	b.WriteString(body)
	return []byte(b.String())
}
