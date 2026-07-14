// Package syncer runs the background registrar-sync worker: it periodically
// polls the registry for each customer domain's authoritative expiry and
// reconciles customer_domains.expires_at (WHMCS "Domain Sync").
package syncer

import (
	"context"
	"errors"
	"log"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/f2cothai/f2-website/services/reseller-api/internal/config"
	"github.com/f2cothai/f2-website/services/reseller-api/internal/notify"
	"github.com/f2cothai/f2-website/services/reseller-api/internal/registry"
)

// Modes for RESELLER_SYNC_MODE.
const (
	ModeOff    = "off"    // worker never starts
	ModeNotify = "notify" // fetch + alert on drift, never overwrite expires_at
	ModeWrite  = "write"  // fetch + write expires_at from the registry
)

// DomainSyncer walks customer_domains oldest-synced-first, in batches, and
// for each domain asks the owning registry adapter for its live expiry.
// Adapters that can't sync (THNIC stub, Mock) return ErrSyncUnsupported and
// are skipped. All work is best-effort and self-throttling: last_synced_at
// is stamped on every attempt so the batch rotates across ticks.
type DomainSyncer struct {
	DB     *pgxpool.Pool
	Router *registry.Router
	Notify *notify.Client
	Cfg    config.Config
	Tick   time.Duration
	Batch  int
	stopCh chan struct{}
}

func New(db *pgxpool.Pool, router *registry.Router, n *notify.Client, cfg config.Config) *DomainSyncer {
	tick := cfg.SyncInterval
	if tick <= 0 {
		tick = 24 * time.Hour
	}
	batch := cfg.SyncBatch
	if batch <= 0 {
		batch = 50
	}
	return &DomainSyncer{
		DB:     db,
		Router: router,
		Notify: n,
		Cfg:    cfg,
		Tick:   tick,
		Batch:  batch,
		stopCh: make(chan struct{}),
	}
}

func (s *DomainSyncer) Start() {
	if s.Cfg.SyncMode == ModeOff || s.Cfg.SyncMode == "" {
		log.Printf("reseller-api domain sync: disabled (RESELLER_SYNC_MODE=off)")
		return
	}
	go s.loop()
}

func (s *DomainSyncer) Stop() { close(s.stopCh) }

func (s *DomainSyncer) loop() {
	log.Printf("reseller-api domain sync: started, mode=%s tick=%s batch=%d", s.Cfg.SyncMode, s.Tick, s.Batch)
	t := time.NewTicker(s.Tick)
	defer t.Stop()
	s.runOnce() // catch up immediately on start
	for {
		select {
		case <-s.stopCh:
			log.Print("reseller-api domain sync: stopping")
			return
		case <-t.C:
			s.runOnce()
		}
	}
}

func (s *DomainSyncer) runOnce() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	synced, err := s.syncBatch(ctx)
	if err != nil {
		log.Printf("domain sync: %v", err)
	} else if synced > 0 {
		log.Printf("domain sync: reconciled %d domain(s)", synced)
	}
}

type domainRow struct {
	id, customerID, customer, domain, registrar, orderID string
	storedExpiry                                         *string // YYYY-MM-DD or nil
}

func (s *DomainSyncer) syncBatch(ctx context.Context) (int, error) {
	// Re-sync a domain roughly once per tick: skip rows touched within the
	// staleness window so the batch rotates through the whole table.
	stalenessSec := int(s.Tick / time.Second)
	rows, err := s.DB.Query(ctx, `
		SELECT d.id, d.customer_id, c.name, d.domain, d.registrar,
		       COALESCE(d.registry_order_id, ''),
		       to_char(d.expires_at, 'YYYY-MM-DD')
		  FROM customer_domains d
		  JOIN customers c ON c.id = d.customer_id
		 WHERE d.last_synced_at IS NULL
		    OR d.last_synced_at < NOW() - ($1::int * INTERVAL '1 second')
		 ORDER BY d.last_synced_at NULLS FIRST
		 LIMIT $2`,
		stalenessSec, s.Batch)
	if err != nil {
		return 0, err
	}
	var batch []domainRow
	for rows.Next() {
		var d domainRow
		if err := rows.Scan(&d.id, &d.customerID, &d.customer, &d.domain,
			&d.registrar, &d.orderID, &d.storedExpiry); err != nil {
			rows.Close()
			return 0, err
		}
		batch = append(batch, d)
	}
	rows.Close()

	reconciled := 0
	for _, d := range batch {
		adapter := s.Router.ForDomain(d.domain)
		details, err := adapter.GetDetails(ctx, d.domain, d.orderID)
		if err != nil {
			// Unsupported (THNIC/Mock) or a transient registry error: stamp
			// the attempt so we rotate on, and move to the next domain.
			if !errors.Is(err, registry.ErrSyncUnsupported) {
				log.Printf("domain sync: %s via %s: %v", d.domain, adapter.Name(), err)
			}
			s.stamp(ctx, d.id, "", nil)
			continue
		}

		regDate := details.ExpiresAt.Format("2006-01-02")
		drift := d.storedExpiry == nil || *d.storedExpiry != regDate

		if s.Cfg.SyncMode == ModeWrite {
			// Authoritative overwrite of expiry + cache the order id.
			s.stamp(ctx, d.id, details.RegistryOrderID, &details.ExpiresAt)
			if drift {
				reconciled++
			}
			continue
		}

		// ModeNotify: cache the order id, never touch expiry; alert on drift.
		s.stamp(ctx, d.id, details.RegistryOrderID, nil)
		if drift {
			s.alertDrift(d, regDate, details.Status)
			reconciled++
		}
	}
	return reconciled, nil
}

// stamp bumps last_synced_at and optionally caches the registry order id
// and/or writes the expiry (write mode only). One statement per domain.
func (s *DomainSyncer) stamp(ctx context.Context, id, orderID string, expiresAt *time.Time) {
	if _, err := s.DB.Exec(ctx, `
		UPDATE customer_domains
		   SET last_synced_at    = NOW(),
		       registry_order_id = COALESCE(NULLIF($2, ''), registry_order_id),
		       expires_at        = COALESCE($3, expires_at)
		 WHERE id = $1`, id, orderID, expiresAt); err != nil {
		log.Printf("domain sync stamp %s: %v", id, err)
	}
}

func (s *DomainSyncer) alertDrift(d domainRow, registryExpiry, registryStatus string) {
	if s.Notify == nil || s.Cfg.BillingNotifyTo == "" {
		return
	}
	stored := "(none on file)"
	if d.storedExpiry != nil {
		stored = *d.storedExpiry
	}
	adminLink := strings.TrimRight(s.Cfg.AdminBaseURL, "/") + "/admin/customers/" + d.customerID
	s.Notify.Send(notify.Job{
		Template:  "domain_sync_drift",
		ToAddress: s.Cfg.BillingNotifyTo,
		Payload: map[string]any{
			"domain":          d.domain,
			"customer_name":   d.customer,
			"stored_expiry":   stored,
			"registry_expiry": registryExpiry,
			"registry_status": registryStatus,
			"admin_link":      adminLink,
		},
	})
}
