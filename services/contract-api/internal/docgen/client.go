// Package docgen is the HTTP client for the internal docgen service
// (services/docgen). contract-api calls it to render contract documents and to
// discover which template codes have a renderer.
package docgen

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type Client struct {
	BaseURL string
	HTTP    *http.Client
}

func New(baseURL string) *Client {
	return &Client{
		BaseURL: baseURL,
		// PDF conversion via LibreOffice can take a few seconds; give it room.
		HTTP: &http.Client{Timeout: 90 * time.Second},
	}
}

// Rendered holds the two artifacts returned by POST /render.
type Rendered struct {
	Docx []byte
	PDF  []byte
}

type renderReq struct {
	Template  string         `json:"template"`
	Data      map[string]any `json:"data"`
	Watermark bool           `json:"watermark"`
}

type renderResp struct {
	DocxB64 string `json:"docx_b64"`
	PDFB64  string `json:"pdf_b64"`
	Error   string `json:"error"`
}

// Render asks docgen to build the docx + PDF for a template + merge data.
func (c *Client) Render(ctx context.Context, template string, data map[string]any, watermark bool) (*Rendered, error) {
	body, _ := json.Marshal(renderReq{Template: template, Data: data, Watermark: watermark})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/render", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("docgen unreachable: %w", err)
	}
	defer resp.Body.Close()

	var out renderResp
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("docgen bad response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		if out.Error != "" {
			return nil, fmt.Errorf("docgen error (%d): %s", resp.StatusCode, out.Error)
		}
		return nil, fmt.Errorf("docgen error: status %d", resp.StatusCode)
	}
	docx, err := base64.StdEncoding.DecodeString(out.DocxB64)
	if err != nil {
		return nil, fmt.Errorf("bad docx payload: %w", err)
	}
	pdf, err := base64.StdEncoding.DecodeString(out.PDFB64)
	if err != nil {
		return nil, fmt.Errorf("bad pdf payload: %w", err)
	}
	return &Rendered{Docx: docx, PDF: pdf}, nil
}

// Templates returns the template codes docgen can render (capability list).
// Used to validate a template's code on create/edit before persisting it.
func (c *Client) Templates(ctx context.Context) ([]string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.BaseURL+"/templates", nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("docgen unreachable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("docgen /templates status %d", resp.StatusCode)
	}
	var out struct {
		Templates []string `json:"templates"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return out.Templates, nil
}
