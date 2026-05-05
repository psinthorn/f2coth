package store

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/f2cothai/f2-website/services/reseller-api/internal/models"
)

type AvailabilityCache struct {
	DB  *pgxpool.Pool
	TTL time.Duration
}

// Lookup returns a cached row if it's still fresh. Misses return nil, nil.
func (c *AvailabilityCache) Lookup(ctx context.Context, fqdn string) (*models.AvailabilityResult, error) {
	var (
		available  bool
		classif    string
		source     string
		checkedAt  time.Time
		expiresAt  time.Time
	)
	err := c.DB.QueryRow(ctx, `
        SELECT available, classification, source, checked_at, expires_at
        FROM domain_availability_cache
        WHERE fqdn = $1
    `, fqdn).Scan(&available, &classif, &source, &checkedAt, &expiresAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if time.Now().After(expiresAt) {
		return nil, nil
	}
	return &models.AvailabilityResult{
		FQDN:           fqdn,
		Available:      available,
		Classification: models.Classification(classif),
		Source:         source,
		CheckedAt:      checkedAt,
		Cached:         true,
	}, nil
}

func (c *AvailabilityCache) Save(ctx context.Context, r models.AvailabilityResult) error {
	raw, _ := json.Marshal(r)
	_, err := c.DB.Exec(ctx, `
        INSERT INTO domain_availability_cache (fqdn, available, classification, source, raw_response, checked_at, expires_at)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
        ON CONFLICT (fqdn) DO UPDATE SET
            available      = EXCLUDED.available,
            classification = EXCLUDED.classification,
            source         = EXCLUDED.source,
            raw_response   = EXCLUDED.raw_response,
            checked_at     = EXCLUDED.checked_at,
            expires_at     = EXCLUDED.expires_at
    `, r.FQDN, r.Available, string(r.Classification), r.Source, raw, r.CheckedAt, r.CheckedAt.Add(c.TTL))
	return err
}

// PurgeExpired is a fire-and-forget janitor. We call it on each lookup batch
// so the table doesn't grow unbounded; cheap because there's an index on
// expires_at.
func (c *AvailabilityCache) PurgeExpired(ctx context.Context) {
	_, _ = c.DB.Exec(ctx, `SELECT purge_expired_availability_cache()`)
}
