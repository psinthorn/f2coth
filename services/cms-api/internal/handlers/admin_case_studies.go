package handlers

// admin_case_studies.go — CRUD for the `case_studies` table used on the
// homepage trusted-by strip and /case-studies pages. Editors receive raw
// {en, th} pairs; public read (cms.go) COALESCEs on the request locale.
//
// Routes (/api/cms/admin/case-studies):
//   GET    /         — list all (incl. unpublished)
//   POST   /         — create
//   GET    /{slug}   — get single
//   PATCH  /{slug}   — partial update
//   DELETE /{slug}   — hard delete

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

type AdminCaseStudy struct {
	ID                string            `json:"id"`
	Slug              string            `json:"slug"`
	ClientName        string            `json:"client_name"`
	Industry          string            `json:"industry"`
	Location          *string           `json:"location,omitempty"`
	RelationshipYears *int              `json:"relationship_years,omitempty"`
	HeroImageURL      *string           `json:"hero_image_url,omitempty"`
	Summary           map[string]string `json:"summary"`
	Challenge         map[string]string `json:"challenge"`
	Solution          map[string]string `json:"solution"`
	Results           map[string]string `json:"results"`
	QuoteText         map[string]string `json:"quote_text"`
	QuoteAuthor       *string           `json:"quote_author,omitempty"`
	ServicesUsed      []string          `json:"services_used"`
	SortOrder         int               `json:"sort_order"`
	IsPublished       bool              `json:"is_published"`
	PublishedAt       *time.Time        `json:"published_at,omitempty"`
	CreatedAt         time.Time         `json:"created_at"`
	UpdatedAt         time.Time         `json:"updated_at"`
}

type caseStudyWriteReq struct {
	Slug              string   `json:"slug"`
	ClientName        string   `json:"client_name"`
	Industry          string   `json:"industry"`
	Location          *string  `json:"location"`
	RelationshipYears *int     `json:"relationship_years"`
	HeroImageURL      *string  `json:"hero_image_url"`
	SummaryEN         string   `json:"summary_en"`
	SummaryTH         string   `json:"summary_th"`
	ChallengeEN       string   `json:"challenge_en"`
	ChallengeTH       string   `json:"challenge_th"`
	SolutionEN        string   `json:"solution_en"`
	SolutionTH        string   `json:"solution_th"`
	ResultsEN         string   `json:"results_en"`
	ResultsTH         string   `json:"results_th"`
	QuoteTextEN       string   `json:"quote_text_en"`
	QuoteTextTH       string   `json:"quote_text_th"`
	QuoteAuthor       *string  `json:"quote_author"`
	ServicesUsed      []string `json:"services_used"`
	SortOrder         *int     `json:"sort_order"`
	IsPublished       *bool    `json:"is_published"`
	PublishedAt       *string  `json:"published_at"`
}

const adminCaseStudySelect = `
SELECT id, slug, client_name, industry, location, relationship_years,
       hero_image_url,
       summary, challenge, solution, results, quote_text,
       quote_author, to_json(services_used) AS services_used,
       sort_order, is_published, published_at, created_at, updated_at
FROM case_studies`

func scanAdminCaseStudy(row interface {
	Scan(...any) error
}) (AdminCaseStudy, error) {
	var c AdminCaseStudy
	var summaryRaw, challengeRaw, solutionRaw, resultsRaw, quoteRaw, servicesRaw []byte
	err := row.Scan(&c.ID, &c.Slug, &c.ClientName, &c.Industry, &c.Location,
		&c.RelationshipYears, &c.HeroImageURL,
		&summaryRaw, &challengeRaw, &solutionRaw, &resultsRaw, &quoteRaw,
		&c.QuoteAuthor, &servicesRaw,
		&c.SortOrder, &c.IsPublished, &c.PublishedAt, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return c, err
	}
	c.Summary = map[string]string{}
	c.Challenge = map[string]string{}
	c.Solution = map[string]string{}
	c.Results = map[string]string{}
	c.QuoteText = map[string]string{}
	c.ServicesUsed = []string{}
	_ = json.Unmarshal(summaryRaw, &c.Summary)
	_ = json.Unmarshal(challengeRaw, &c.Challenge)
	_ = json.Unmarshal(solutionRaw, &c.Solution)
	_ = json.Unmarshal(resultsRaw, &c.Results)
	_ = json.Unmarshal(quoteRaw, &c.QuoteText)
	_ = json.Unmarshal(servicesRaw, &c.ServicesUsed)
	return c, nil
}

// GET /api/cms/admin/case-studies
func (h *CMSHandler) AdminListCaseStudies(w http.ResponseWriter, r *http.Request) {
	rows, err := h.DB.Query(r.Context(),
		adminCaseStudySelect+` ORDER BY sort_order, client_name LIMIT 200`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	out := make([]AdminCaseStudy, 0, 16)
	for rows.Next() {
		c, err := scanAdminCaseStudy(rows)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, c)
	}
	writeJSON(w, http.StatusOK, map[string]any{"case_studies": out})
}

// GET /api/cms/admin/case-studies/{slug}
func (h *CMSHandler) AdminGetCaseStudy(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	row := h.DB.QueryRow(r.Context(), adminCaseStudySelect+` WHERE slug = $1`, slug)
	c, err := scanAdminCaseStudy(row)
	if err == pgx.ErrNoRows {
		writeErr(w, http.StatusNotFound, "case study not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	writeJSON(w, http.StatusOK, c)
}

// POST /api/cms/admin/case-studies
func (h *CMSHandler) AdminCreateCaseStudy(w http.ResponseWriter, r *http.Request) {
	var req caseStudyWriteReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 512*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.Slug = strings.TrimSpace(strings.ToLower(req.Slug))
	req.ClientName = strings.TrimSpace(req.ClientName)
	if req.Slug == "" || req.ClientName == "" || req.Industry == "" {
		writeErr(w, http.StatusBadRequest, "slug, client_name, industry are required")
		return
	}
	if req.ServicesUsed == nil {
		req.ServicesUsed = []string{}
	}
	sortOrder := 0
	if req.SortOrder != nil {
		sortOrder = *req.SortOrder
	}
	isPublished := true
	if req.IsPublished != nil {
		isPublished = *req.IsPublished
	}

	summaryJSON, _ := json.Marshal(map[string]string{"en": req.SummaryEN, "th": req.SummaryTH})
	challengeJSON, _ := json.Marshal(map[string]string{"en": req.ChallengeEN, "th": req.ChallengeTH})
	solutionJSON, _ := json.Marshal(map[string]string{"en": req.SolutionEN, "th": req.SolutionTH})
	resultsJSON, _ := json.Marshal(map[string]string{"en": req.ResultsEN, "th": req.ResultsTH})
	quoteJSON, _ := json.Marshal(map[string]string{"en": req.QuoteTextEN, "th": req.QuoteTextTH})

	var publishedAt *time.Time
	if req.PublishedAt != nil && *req.PublishedAt != "" {
		t, err := time.Parse(time.RFC3339, *req.PublishedAt)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "published_at must be RFC3339")
			return
		}
		publishedAt = &t
	} else if isPublished {
		now := time.Now().UTC()
		publishedAt = &now
	}

	var id string
	err := h.DB.QueryRow(r.Context(), `
		INSERT INTO case_studies (
			slug, client_name, industry, location, relationship_years, hero_image_url,
			summary, challenge, solution, results, quote_text, quote_author,
			services_used, sort_order, is_published, published_at)
		VALUES ($1,$2,$3,$4,$5,$6, $7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12,
		        $13,$14,$15,$16)
		RETURNING id`,
		req.Slug, req.ClientName, req.Industry, req.Location, req.RelationshipYears, req.HeroImageURL,
		summaryJSON, challengeJSON, solutionJSON, resultsJSON, quoteJSON, req.QuoteAuthor,
		req.ServicesUsed, sortOrder, isPublished, publishedAt,
	).Scan(&id)
	if err != nil {
		if strings.Contains(err.Error(), "unique") {
			writeErr(w, http.StatusConflict, "slug already exists")
			return
		}
		writeErr(w, http.StatusInternalServerError, "create failed")
		return
	}
	row := h.DB.QueryRow(r.Context(), adminCaseStudySelect+` WHERE id = $1`, id)
	c, _ := scanAdminCaseStudy(row)
	writeJSON(w, http.StatusCreated, c)
}

// PATCH /api/cms/admin/case-studies/{slug}
func (h *CMSHandler) AdminUpdateCaseStudy(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	var req caseStudyWriteReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 512*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	pRow := h.DB.QueryRow(r.Context(), adminCaseStudySelect+` WHERE slug = $1`, slug)
	cur, err := scanAdminCaseStudy(pRow)
	if err == pgx.ErrNoRows {
		writeErr(w, http.StatusNotFound, "case study not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}

	mergeStr := func(cur map[string]string, en, th string) map[string]string {
		if en != "" {
			cur["en"] = en
		}
		if th != "" {
			cur["th"] = th
		}
		return cur
	}
	summary := mergeStr(cur.Summary, req.SummaryEN, req.SummaryTH)
	challenge := mergeStr(cur.Challenge, req.ChallengeEN, req.ChallengeTH)
	solution := mergeStr(cur.Solution, req.SolutionEN, req.SolutionTH)
	results := mergeStr(cur.Results, req.ResultsEN, req.ResultsTH)
	quote := mergeStr(cur.QuoteText, req.QuoteTextEN, req.QuoteTextTH)

	clientName := cur.ClientName
	if req.ClientName != "" {
		clientName = req.ClientName
	}
	industry := cur.Industry
	if req.Industry != "" {
		industry = req.Industry
	}
	location := cur.Location
	if req.Location != nil {
		location = req.Location
	}
	relYears := cur.RelationshipYears
	if req.RelationshipYears != nil {
		relYears = req.RelationshipYears
	}
	heroURL := cur.HeroImageURL
	if req.HeroImageURL != nil {
		heroURL = req.HeroImageURL
	}
	quoteAuthor := cur.QuoteAuthor
	if req.QuoteAuthor != nil {
		quoteAuthor = req.QuoteAuthor
	}
	servicesUsed := cur.ServicesUsed
	if req.ServicesUsed != nil {
		servicesUsed = req.ServicesUsed
	}
	sortOrder := cur.SortOrder
	if req.SortOrder != nil {
		sortOrder = *req.SortOrder
	}
	isPublished := cur.IsPublished
	if req.IsPublished != nil {
		isPublished = *req.IsPublished
	}
	newSlug := cur.Slug
	if req.Slug != "" {
		newSlug = strings.TrimSpace(strings.ToLower(req.Slug))
	}

	var publishedAt *time.Time
	if req.PublishedAt != nil {
		if *req.PublishedAt == "" {
			publishedAt = nil
		} else {
			t, err := time.Parse(time.RFC3339, *req.PublishedAt)
			if err != nil {
				writeErr(w, http.StatusBadRequest, "published_at must be RFC3339")
				return
			}
			publishedAt = &t
		}
	} else if cur.PublishedAt != nil {
		publishedAt = cur.PublishedAt
	} else if isPublished && !cur.IsPublished {
		now := time.Now().UTC()
		publishedAt = &now
	}

	summaryJSON, _ := json.Marshal(summary)
	challengeJSON, _ := json.Marshal(challenge)
	solutionJSON, _ := json.Marshal(solution)
	resultsJSON, _ := json.Marshal(results)
	quoteJSON, _ := json.Marshal(quote)

	_, err = h.DB.Exec(r.Context(), `
		UPDATE case_studies SET
			slug               = $2,
			client_name        = $3,
			industry           = $4,
			location           = $5,
			relationship_years = $6,
			hero_image_url     = $7,
			summary            = $8::jsonb,
			challenge          = $9::jsonb,
			solution           = $10::jsonb,
			results            = $11::jsonb,
			quote_text         = $12::jsonb,
			quote_author       = $13,
			services_used      = $14,
			sort_order         = $15,
			is_published       = $16,
			published_at       = $17
		WHERE slug = $1`,
		slug, newSlug, clientName, industry, location, relYears, heroURL,
		summaryJSON, challengeJSON, solutionJSON, resultsJSON, quoteJSON, quoteAuthor,
		servicesUsed, sortOrder, isPublished, publishedAt,
	)
	if err != nil {
		if strings.Contains(err.Error(), "unique") {
			writeErr(w, http.StatusConflict, "slug already exists")
			return
		}
		writeErr(w, http.StatusInternalServerError, "update failed")
		return
	}
	row := h.DB.QueryRow(r.Context(), adminCaseStudySelect+` WHERE slug = $1`, newSlug)
	c, _ := scanAdminCaseStudy(row)
	writeJSON(w, http.StatusOK, c)
}

// DELETE /api/cms/admin/case-studies/{slug}
func (h *CMSHandler) AdminDeleteCaseStudy(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	tag, err := h.DB.Exec(r.Context(), `DELETE FROM case_studies WHERE slug = $1`, slug)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "delete failed")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "case study not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
