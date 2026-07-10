package handlers

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	mw "github.com/f2cothai/f2-website/services/contract-api/internal/middleware"
)

type generateReq struct {
	// Watermark on => draft copy (stays draft). Watermark off => signing
	// version (transitions draft → sent). Defaults to true (safe: a draft).
	Watermark *bool `json:"watermark"`
}

// POST /api/contracts/{id}/generate (staff) — render docx+pdf via docgen and
// attach them to the contract. Draft copy is watermarked; the signing version
// (watermark=false) removes it and advances draft → sent.
func (h *Handler) GenerateContract(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req generateReq
	_ = json.NewDecoder(r.Body).Decode(&req) // empty body allowed
	watermark := true
	if req.Watermark != nil {
		watermark = *req.Watermark
	}

	// Load contract + template code + version + status.
	var (
		templateCode, templateVersion, docNo, status string
		mergeData                                    json.RawMessage
		partyID                                      string
	)
	err := h.DB.QueryRow(r.Context(), `
		SELECT t.code, t.version, c.doc_no, c.status, c.merge_data, c.party_id
		  FROM contracts c JOIN contract_templates t ON t.id = c.template_id
		 WHERE c.id = $1`, id).Scan(&templateCode, &templateVersion, &docNo, &status, &mergeData, &partyID)
	if err == pgx.ErrNoRows {
		writeErr(w, http.StatusNotFound, "contract not found")
		return
	} else if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}

	// Signing version can only be generated from draft (draft → sent). A
	// watermarked draft copy can be regenerated at any pre-signed stage.
	if !watermark && status != "draft" {
		writeErr(w, http.StatusConflict, "signing version can only be generated from a draft")
		return
	}

	data, err := h.buildMergeData(r.Context(), partyID, mergeData, docNo, templateVersion)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "merge data: "+err.Error())
		return
	}

	rendered, err := h.Docgen.Render(r.Context(), templateCode, data, watermark)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "docgen: "+err.Error())
		return
	}

	// Persist both artifacts to the volume + metadata rows. Replace any prior
	// generated files so a contract shows only its latest generation.
	userID := mw.UserID(r.Context())
	if _, err := h.DB.Exec(r.Context(),
		`DELETE FROM contract_files WHERE contract_id = $1 AND kind IN ('generated_docx','generated_pdf')`, id); err != nil {
		writeErr(w, http.StatusInternalServerError, "cleanup: "+err.Error())
		return
	}
	if err := h.storeGenerated(r.Context(), id, "generated_docx", docNo+".docx",
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document", rendered.Docx, userID); err != nil {
		writeErr(w, http.StatusInternalServerError, "store docx: "+err.Error())
		return
	}
	if err := h.storeGenerated(r.Context(), id, "generated_pdf", docNo+".pdf",
		"application/pdf", rendered.PDF, userID); err != nil {
		writeErr(w, http.StatusInternalServerError, "store pdf: "+err.Error())
		return
	}

	// Signing version advances the lifecycle.
	if !watermark && status == "draft" {
		tx, err := h.DB.Begin(r.Context())
		if err == nil {
			defer tx.Rollback(r.Context())
			if _, err := tx.Exec(r.Context(), `UPDATE contracts SET status = 'sent' WHERE id = $1`, id); err == nil {
				_ = recordStatusEvent(r.Context(), tx, id, "draft", "sent", "signing version generated", userID)
				_ = tx.Commit(r.Context())
				status = "sent"
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status":    status,
		"watermark": watermark,
		"doc_no":    docNo,
	})
}

// storeGenerated writes bytes to the volume and inserts a contract_files row.
func (h *Handler) storeGenerated(ctx context.Context, contractID, kind, filename, mime string, payload []byte, userID string) error {
	ext := ".bin"
	switch kind {
	case "generated_docx":
		ext = ".docx"
	case "generated_pdf":
		ext = ".pdf"
	}
	path, sum, err := h.saveBytes(payload, ext)
	if err != nil {
		return err
	}
	_, err = h.DB.Exec(ctx, `
		INSERT INTO contract_files
			(contract_id, kind, filename, storage_path, mime_type, size_bytes, sha256, uploaded_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7, NULLIF($8,'')::uuid)`,
		contractID, kind, filename, path, mime, len(payload), sum, userID)
	return err
}

// buildMergeData assembles the docgen `data` object: party legal details +
// the contract's merge fields + doc_no + template version.
func (h *Handler) buildMergeData(ctx context.Context, partyID string, mergeData json.RawMessage, docNo, version string) (map[string]any, error) {
	party, err := h.loadParty(ctx, partyID)
	if err != nil {
		return nil, err
	}
	data := map[string]any{}
	if len(mergeData) > 0 {
		if err := json.Unmarshal(mergeData, &data); err != nil {
			return nil, err
		}
	}
	// Party fields (top-level, consumed by docgen builders).
	data["legal_name_en"] = party.LegalNameEN
	data["legal_name_th"] = party.LegalNameTH
	setIfPtr(data, "brand_name", party.BrandName)
	setIfPtr(data, "tax_id", party.TaxID)
	setIfPtr(data, "address", party.Address)
	setIfPtr(data, "notice_email", party.NoticeEmail)
	setIfPtr(data, "contact_person", party.ContactPerson)
	setIfPtr(data, "phone", party.Phone)
	data["doc_no"] = docNo
	data["template_version"] = version
	return data, nil
}

func setIfPtr(m map[string]any, k string, v *string) {
	if v != nil && *v != "" {
		m[k] = *v
	}
}
