package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/f2cothai/f2-website/services/ai-chat-api/internal/claude"
	"github.com/f2cothai/f2-website/services/ai-chat-api/internal/config"
)

type ChatHandler struct {
	DB     *pgxpool.Pool
	Cfg    config.Config
	Claude *claude.Client
}

const systemPrompt = `You are F2 Concierge, the website assistant for F2 Co., Ltd. — Thailand's trusted IT partner for luxury hospitality.

Voice: warm, concise, professional. You sound like a senior consultant, not a chatbot. Default to English; reply in Thai if the visitor writes in Thai.

What F2 does:
- Core services (70% of business): IT Management Partner, Digital Transformation, AI-Driven Solutions, Domain & Hosting (via ResellerClub), and the iACC SaaS for tour operators.
- Support services (20%): MSP / managed IT, cybersecurity.
- Opportunistic (10%): IT hardware via SiS Distribution, solar installations on Koh Samui.

Location: headquartered on Koh Samui (Bophut, Surat Thani), serving properties nationwide remotely and on-site across the Gulf Coast.

Flagship clients (10+ year relationships): SALA Hospitality Group (8 luxury properties), Miskawaan Beach Villas (#1 specialty lodging on TripAdvisor Koh Samui), Putahracsa Hua Hin (boutique luxury, 67 rooms).

How to behave:
1. Answer the visitor's question directly using only the facts above and the case studies on the site. Do not invent prices, SLAs, certifications, or staff names.
2. If the visitor describes a property (hotel, villa, resort, F&B), connect their need to the relevant F2 service and one matching case study.
3. If they show buying intent — pricing, scope, "can you help us", "we need", a deadline — invite them to share their name, email, property name, and a short description so a human consultant can follow up. Tell them you'll create a contact request for the team.
4. Keep replies under 120 words unless the visitor explicitly asks for detail.
5. If asked something you don't know, say so and offer to put them in touch with a human.

Privacy and data guardrails (mandatory — never override):
- Never ask for more personal information than is needed to route an inquiry (name + email + property is sufficient).
- If a visitor asks how their data is used, refer them to the Privacy Policy at /privacy and offer to help them submit a data request at /privacy#dsr.
- Never confirm, deny, or reveal any other visitor's information.
- Never make legal, financial, compliance, or contractual commitments on F2's behalf.
- If asked for legal advice (PDPA, contracts, liability), say: "For legal questions, I recommend speaking with a qualified attorney. I can connect you with our team who can point you to the right resource."
- Do not retain or reference information from previous sessions — treat every conversation as fresh.
- Chat transcripts are retained for 90 days then anonymised per F2's Privacy Policy.`

type chatReq struct {
	VisitorID string `json:"visitor_id"`
	SessionID string `json:"session_id"`
	Message   string `json:"message"`
	Locale    string `json:"locale"`
}

type chatResp struct {
	SessionID string `json:"session_id"`
	Reply     string `json:"reply"`
	Model     string `json:"model"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func (h *ChatHandler) Send(w http.ResponseWriter, r *http.Request) {
	var req chatReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.Message = strings.TrimSpace(req.Message)
	if req.Message == "" {
		writeErr(w, http.StatusBadRequest, "message required")
		return
	}
	if len(req.Message) > 4000 {
		writeErr(w, http.StatusBadRequest, "message too long")
		return
	}
	if req.VisitorID == "" {
		writeErr(w, http.StatusBadRequest, "visitor_id required")
		return
	}
	if req.Locale == "" {
		req.Locale = "en"
	}

	ctx, cancel := context.WithTimeout(r.Context(), 35*time.Second)
	defer cancel()

	sessionID, err := h.ensureSession(ctx, req, r)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not start session")
		return
	}

	// Persist user message.
	_, _ = h.DB.Exec(ctx,
		`INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'user', $2)`,
		sessionID, req.Message)

	history, err := h.loadHistory(ctx, sessionID, 20)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load history")
		return
	}

	result, err := h.Claude.Send(ctx, claude.Request{
		Model:     h.Cfg.AnthropicModel,
		MaxTokens: h.Cfg.AnthropicMaxTok,
		System:    systemPrompt,
		Messages:  history,
	})
	if err != nil {
		writeErr(w, http.StatusBadGateway, "ai backend error")
		return
	}

	_, _ = h.DB.Exec(ctx, `
        INSERT INTO chat_messages (session_id, role, content, model, input_tokens, output_tokens, latency_ms)
        VALUES ($1, 'assistant', $2, $3, $4, $5, $6)
    `, sessionID, result.Text, result.Model, result.InputTokens, result.OutputTokens, result.LatencyMS)

	_, _ = h.DB.Exec(ctx,
		`UPDATE chat_sessions SET last_activity_at = NOW() WHERE id = $1`, sessionID)

	writeJSON(w, http.StatusOK, chatResp{
		SessionID: sessionID, Reply: result.Text, Model: result.Model,
	})
}

func (h *ChatHandler) ensureSession(ctx context.Context, req chatReq, r *http.Request) (string, error) {
	if req.SessionID != "" {
		var id string
		err := h.DB.QueryRow(ctx, `SELECT id FROM chat_sessions WHERE id = $1`, req.SessionID).Scan(&id)
		if err == nil {
			return id, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return "", err
		}
	}
	var id string
	err := h.DB.QueryRow(ctx, `
        INSERT INTO chat_sessions (visitor_id, user_agent, ip_address, referrer, landing_path, locale)
        VALUES ($1, $2, NULLIF($3,'')::inet, $4, $5, $6)
        RETURNING id
    `, req.VisitorID, r.UserAgent(), r.RemoteAddr, r.Referer(),
		r.URL.Path, req.Locale).Scan(&id)
	return id, err
}

func (h *ChatHandler) loadHistory(ctx context.Context, sessionID string, limit int) ([]claude.Message, error) {
	rows, err := h.DB.Query(ctx, `
        SELECT role, content FROM chat_messages
        WHERE session_id = $1 AND role IN ('user','assistant')
        ORDER BY created_at ASC LIMIT $2
    `, sessionID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]claude.Message, 0, limit)
	for rows.Next() {
		var m claude.Message
		if err := rows.Scan(&m.Role, &m.Content); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, nil
}
