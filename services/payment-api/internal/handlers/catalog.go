package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/f2cothai/f2-website/services/payment-api/internal/config"
)

// CatalogHandler returns the product picker data for the admin
// subscription create form. Combines hosting_plans (global catalog,
// from cms-api's tables) with the customer's own active SLA contracts
// so an admin can spin up a recurring subscription pre-filled with
// title + amount + product reference in one click.
type CatalogHandler struct {
	DB  *pgxpool.Pool
	Cfg config.Config
}

type catalogHosting struct {
	ID            string `json:"id"`
	Slug          string `json:"slug"`
	NameEN        string `json:"name_en"`
	NameTH        string `json:"name_th"`
	MonthlyCents  int64  `json:"monthly_cents"`
	AnnuallyCents int64  `json:"annually_cents"`
}

type catalogSLA struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	StartsOn string `json:"starts_on"`
	EndsOn   string `json:"ends_on"`
	Status   string `json:"status"`
}

type catalogResp struct {
	Hosting []catalogHosting `json:"hosting"`
	SLA     []catalogSLA     `json:"sla"`
}

// AdminList — `?customer_id=` parameter filters SLA contracts; hosting
// plans are global.
func (h *CatalogHandler) AdminList(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	out := catalogResp{Hosting: []catalogHosting{}, SLA: []catalogSLA{}}

	rows, err := h.DB.Query(ctx, `
		SELECT id, slug, name, price_thb_monthly, price_thb_annually
		  FROM hosting_plans
		 WHERE is_published = true
		 ORDER BY sort_order, slug`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var (
				id, slug          string
				nameJSON          []byte
				monthly, annually int
			)
			if err := rows.Scan(&id, &slug, &nameJSON, &monthly, &annually); err != nil {
				writeErr(w, 500, err.Error())
				return
			}
			var nameMap map[string]string
			_ = json.Unmarshal(nameJSON, &nameMap)
			out.Hosting = append(out.Hosting, catalogHosting{
				ID:            id,
				Slug:          slug,
				NameEN:        nameMap["en"],
				NameTH:        nameMap["th"],
				MonthlyCents:  int64(monthly) * 100,
				AnnuallyCents: int64(annually) * 100,
			})
		}
	}

	customerID := r.URL.Query().Get("customer_id")
	if customerID != "" {
		slaRows, err := h.DB.Query(ctx, `
			SELECT id, title, to_char(starts_on,'YYYY-MM-DD'),
			       to_char(ends_on,'YYYY-MM-DD'), status
			  FROM customer_sla_contracts
			 WHERE customer_id = $1
			   AND status IN ('active','renewing')
			 ORDER BY ends_on`, customerID)
		if err == nil {
			defer slaRows.Close()
			for slaRows.Next() {
				var s catalogSLA
				if err := slaRows.Scan(&s.ID, &s.Title, &s.StartsOn, &s.EndsOn, &s.Status); err != nil {
					writeErr(w, 500, err.Error())
					return
				}
				out.SLA = append(out.SLA, s)
			}
		}
	}

	writeJSON(w, 200, out)
}
