// Package report contains the background worker that renders AssetHub
// handover documents. It mirrors notification-api's DB-queue pattern: a
// ticker polls assethub_report_jobs for 'queued' rows, renders the file to
// the reports volume, and flips status to 'done' (or 'failed'/'dead').
package report

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	pollInterval = 5 * time.Second
	maxAttempts  = 3
	batchSize    = 5
)

type Worker struct {
	DB         *pgxpool.Pool
	DocgenURL  string
	ReportsDir string
}

// Start runs the poll loop until ctx is cancelled.
func (wk *Worker) Start(ctx context.Context) {
	log.Printf("assethub report worker started (reports=%s)", wk.ReportsDir)
	t := time.NewTicker(pollInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			log.Printf("assethub report worker stopping")
			return
		case <-t.C:
			if err := wk.drainOnce(ctx); err != nil {
				log.Printf("assethub report worker: drain error: %v", err)
			}
		}
	}
}

func (wk *Worker) drainOnce(ctx context.Context) error {
	rows, err := wk.DB.Query(ctx, `
		SELECT id, customer_id, site_id, format, attempts
		FROM assethub_report_jobs
		WHERE status='queued' AND scheduled_at <= NOW()
		ORDER BY created_at LIMIT $1`, batchSize)
	if err != nil {
		return err
	}
	type job struct {
		id, customerID, format string
		siteID                 *string
		attempts               int
	}
	var jobs []job
	for rows.Next() {
		var j job
		if err := rows.Scan(&j.id, &j.customerID, &j.siteID, &j.format, &j.attempts); err != nil {
			rows.Close()
			return err
		}
		jobs = append(jobs, j)
	}
	rows.Close()

	for _, j := range jobs {
		// Claim the row so a second worker instance can't double-render.
		tag, err := wk.DB.Exec(ctx, `UPDATE assethub_report_jobs SET status='processing', attempts=attempts+1 WHERE id=$1 AND status='queued'`, j.id)
		if err != nil || tag.RowsAffected() == 0 {
			continue
		}
		path, rerr := wk.render(ctx, j.id, j.customerID, j.siteID, j.format)
		if rerr != nil {
			status := "queued"
			if j.attempts+1 >= maxAttempts {
				status = "dead"
			}
			_, _ = wk.DB.Exec(ctx, `UPDATE assethub_report_jobs SET status=$2, error=$3 WHERE id=$1`, j.id, status, rerr.Error())
			log.Printf("assethub report %s: render failed (attempt %d): %v", j.id, j.attempts+1, rerr)
			continue
		}
		_, _ = wk.DB.Exec(ctx, `UPDATE assethub_report_jobs SET status='done', file_path=$2, error=NULL WHERE id=$1`, j.id, path)
		log.Printf("assethub report %s: done → %s", j.id, path)
	}
	return nil
}

// render produces the handover file and returns its absolute path.
func (wk *Worker) render(ctx context.Context, jobID, customerID string, siteID *string, format string) (string, error) {
	data, err := wk.gather(ctx, customerID, siteID)
	if err != nil {
		return "", err
	}
	dir := filepath.Join(wk.ReportsDir, customerID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	out := filepath.Join(dir, jobID+"."+format)

	switch format {
	case "xlsx":
		if err := renderXLSX(out, data); err != nil {
			return "", err
		}
	case "pdf", "docx":
		blob, err := wk.renderViaDocgen(ctx, data, format)
		if err != nil {
			return "", err
		}
		if err := os.WriteFile(out, blob, 0o644); err != nil {
			return "", err
		}
	default:
		return "", fmt.Errorf("unsupported format %q", format)
	}
	return out, nil
}

// renderViaDocgen posts the handover data to the docgen service and returns
// the requested binary. docgen must have the 'assethub_handover' builder.
func (wk *Worker) renderViaDocgen(ctx context.Context, data *HandoverData, format string) ([]byte, error) {
	body, _ := json.Marshal(map[string]any{
		"template": "assethub_handover",
		"data":     data,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, wk.DocgenURL+"/render", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 90 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("docgen returned %d", resp.StatusCode)
	}
	var out struct {
		PDFB64  string `json:"pdf_b64"`
		DOCXB64 string `json:"docx_b64"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	b64 := out.PDFB64
	if format == "docx" {
		b64 = out.DOCXB64
	}
	if b64 == "" {
		return nil, fmt.Errorf("docgen returned empty %s", format)
	}
	return base64.StdEncoding.DecodeString(b64)
}
