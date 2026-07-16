package handlers

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/f2cothai/f2-website/services/payment-api/internal/notify"
)

// Sentinel offset_days values used for domain rows in renewal_reminders.
// Real customer before-expiry tiers are always positive (60/30/7), so
// these non-positive sentinels never collide. See migration 058.
const (
	domainStampInternal = 0  // internal billing-team heads-up sent (once/cycle)
	domainStampInvoiced = -1 // renewal invoice generated (idempotency guard)
	domainStampExpired  = -2 // post-expiry "domain expired" notice sent
)

// dispatchDomainRenewals drives the expiry-date renewal loop for
// customer_domains (Phase 2). For each domain in the scan window it may:
//   (A) send an advance expiry notice to the customer (auto_renew only, at
//       the smallest open Cfg.DomainRenewalNoticeOffsets tier) plus a
//       one-per-cycle internal heads-up;
//   (B) auto-generate a renewal invoice from domain_pricing when within
//       Cfg.DomainRenewalInvoiceLead days of expiry (auto_renew only);
//   (C) send a post-expiry "domain expired" notice once, N days after
//       expiry (Cfg.DomainPostExpiryNoticeDays), regardless of auto_renew.
//
// All three are idempotent via renewal_reminders stamps keyed by
// (entity_type='domain', entity_id, due_date=expires_at, offset). The
// stamps reset when staff push a new expires_at after renewing at the
// registrar. Returns the count of domains that had any action this tick.
func (s *Scheduler) dispatchDomainRenewals(ctx context.Context) (int, error) {
	offsets := s.Cfg.DomainRenewalNoticeOffsets // descending, positive
	invoiceLead := s.Cfg.DomainRenewalInvoiceLead
	postExpiry := s.Cfg.DomainPostExpiryNoticeDays
	maxRecovery := s.Cfg.DomainMaxRecoveryDays
	if maxRecovery < 0 {
		maxRecovery = 0
	}

	// Furthest-out day we need to look ahead (max of the largest notice
	// tier and the invoice lead).
	maxBefore := invoiceLead
	if len(offsets) > 0 && offsets[0] > maxBefore {
		maxBefore = offsets[0]
	}
	if maxBefore < 0 {
		maxBefore = 0
	}
	if maxBefore == 0 && postExpiry <= 0 {
		return 0, nil // engine fully disabled
	}

	// How far back to scan for post-expiry notices and late-invoice
	// recovery. Cover both, plus a buffer so we never skip the exact day.
	lowerScan := postExpiry
	if invoiceLead > lowerScan {
		lowerScan = invoiceLead
	}
	if maxRecovery > lowerScan {
		lowerScan = maxRecovery
	}
	if lowerScan < 0 {
		lowerScan = 0
	}
	lowerScan += 7

	rows, err := s.DB.Query(ctx, `
		SELECT d.id, d.customer_id, c.name, d.domain, d.registrar, d.auto_renew,
		       to_char(d.expires_at, 'YYYY-MM-DD') AS expiry_date,
		       (d.expires_at::date - CURRENT_DATE)::int AS days_until
		  FROM customer_domains d
		  JOIN customers c ON c.id = d.customer_id
		 WHERE d.expires_at IS NOT NULL
		   AND d.expires_at::date >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
		   AND d.expires_at::date <= CURRENT_DATE + ($2::int * INTERVAL '1 day')`,
		lowerScan, maxBefore)
	if err != nil {
		return 0, err
	}
	type dom struct {
		id, customerID, customer, domain, registrar, expiryDate string
		autoRenew                                               bool
		daysUntil                                               int
	}
	var domains []dom
	for rows.Next() {
		var d dom
		if err := rows.Scan(&d.id, &d.customerID, &d.customer, &d.domain,
			&d.registrar, &d.autoRenew, &d.expiryDate, &d.daysUntil); err != nil {
			rows.Close()
			return 0, err
		}
		domains = append(domains, d)
	}
	rows.Close()

	acted := 0
	for _, d := range domains {
		already, err := s.sentRenewalOffsets(ctx, "domain", d.id, d.expiryDate)
		if err != nil {
			log.Printf("scheduler: domain stamps %s: %v", d.id, err)
			continue
		}
		didSomething := false

		// (A) Advance expiry notice (auto_renew, before expiry).
		if d.autoRenew && d.daysUntil > 0 && len(offsets) > 0 {
			chosen := -1
			for i := len(offsets) - 1; i >= 0; i-- { // ascending
				o := offsets[i]
				if o < d.daysUntil {
					continue // window not open yet
				}
				if !already[o] {
					chosen = o
					break
				}
			}
			if chosen != -1 {
				// Internal heads-up, once per cycle (independent of the
				// customer contact — goes to the billing team).
				if s.Cfg.BillingNotifyTo != "" && !already[domainStampInternal] {
					adminLink := strings.TrimRight(s.Cfg.AdminBaseURL, "/") + "/admin/customers/" + d.customerID
					s.Notify.Send(notify.Job{
						Template:  "domain_renewal_internal",
						ToAddress: s.Cfg.BillingNotifyTo,
						Payload: map[string]any{
							"customer_name": d.customer,
							"domain":        d.domain,
							"registrar":     d.registrar,
							"expiry_date":   d.expiryDate,
							"days_until":    d.daysUntil,
							"invoice_lead":  invoiceLead,
							"admin_link":    adminLink,
						},
					})
					s.stampRenewal(ctx, "domain", d.id, d.expiryDate, domainStampInternal, "domain_renewal_internal")
					already[domainStampInternal] = true
					didSomething = true
				}
				// Customer notice — only stamp the tiers when we actually
				// have a recipient, else the stamp would permanently suppress
				// the notice for a contact added later.
				if to, locale := lookupBillingContact(ctx, s.DB, d.customerID); to != "" {
					portalLink := strings.TrimRight(s.Cfg.PortalBaseURL, "/") + "/portal/domains"
					s.Notify.Send(notify.Job{
						Template:  "domain_renewal_upcoming",
						ToAddress: to,
						Locale:    locale,
						Payload: map[string]any{
							"customer_name": d.customer,
							"domain":        d.domain,
							"registrar":     d.registrar,
							"expiry_date":   d.expiryDate,
							"days_until":    d.daysUntil,
							"portal_link":   portalLink,
						},
					})
					// Stamp the chosen tier + any larger open tiers (superseded).
					for _, o := range offsets {
						if o < chosen || o < d.daysUntil || already[o] {
							continue
						}
						s.stampRenewal(ctx, "domain", d.id, d.expiryDate, o, "domain_renewal_upcoming")
						already[o] = true
					}
					didSomething = true
				}
			}
		}

		// (B) Auto-generate the renewal invoice (auto_renew, within lead
		// window, incl. a short post-expiry recovery window).
		if d.autoRenew && invoiceLead > 0 && !already[domainStampInvoiced] &&
			d.daysUntil <= invoiceLead && d.daysUntil >= -maxRecovery {
			issued, err := s.issueDomainRenewalInvoice(ctx, d.id, d.customerID, d.domain, d.expiryDate, d.daysUntil)
			if err != nil {
				log.Printf("scheduler: domain renewal invoice %s: %v", d.id, err)
			} else if issued {
				already[domainStampInvoiced] = true
				didSomething = true
			}
		}

		// (C) Post-expiry notice, once, regardless of auto_renew. Only stamp
		// when a recipient exists, else a contact added later never gets it.
		if postExpiry > 0 && !already[domainStampExpired] && d.daysUntil <= -postExpiry {
			if to, locale := lookupBillingContact(ctx, s.DB, d.customerID); to != "" {
				portalLink := strings.TrimRight(s.Cfg.PortalBaseURL, "/") + "/portal/billing"
				s.Notify.Send(notify.Job{
					Template:  "domain_expired",
					ToAddress: to,
					Locale:    locale,
					Payload: map[string]any{
						"customer_name": d.customer,
						"domain":        d.domain,
						"expiry_date":   d.expiryDate,
						"days_expired":  -d.daysUntil,
						"portal_link":   portalLink,
					},
				})
				s.stampRenewal(ctx, "domain", d.id, d.expiryDate, domainStampExpired, "domain_expired")
				already[domainStampExpired] = true
				didSomething = true
			}
		}

		if didSomething {
			acted++
		}
	}
	return acted, nil
}

// domainInvLine is one line of a domain renewal invoice (renewal itself,
// plus grace/redemption recovery fees when the domain has lapsed).
type domainInvLine struct {
	descEN, descTH string
	cents          int64
}

// issueDomainRenewalInvoice creates a renewal invoice for a domain, priced
// from domain_pricing (longest-suffix TLD match). When the domain has
// already expired it adds compounded grace / redemption recovery fees per
// how many days past expiry it is (daysUntil < 0). Returns (false, nil)
// when no active pricing row exists — a silent skip; the internal heads-up
// already told staff to quote it manually. Invoice creation + the
// idempotency stamp are one atomic tx.
func (s *Scheduler) issueDomainRenewalInvoice(ctx context.Context,
	domainID, customerID, domainName, expiryDate string, daysUntil int) (bool, error) {

	lower := strings.ToLower(strings.TrimSpace(domainName))
	var renewTHB, graceDays, redemptionDays, graceFeeTHB, redemptionFeeTHB int
	err := s.DB.QueryRow(ctx, `
		SELECT renew_price_thb, grace_period_days, redemption_period_days,
		       grace_fee_thb, redemption_fee_thb
		  FROM domain_pricing
		 WHERE is_active AND $1 LIKE '%.' || tld
		 ORDER BY length(tld) DESC
		 LIMIT 1`, lower).Scan(&renewTHB, &graceDays, &redemptionDays, &graceFeeTHB, &redemptionFeeTHB)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil // no pricing loaded — skip, admin quotes manually
		}
		return false, err
	}
	if renewTHB <= 0 {
		return false, nil
	}

	// Build the line items. Renewal always; grace/redemption fees stack by
	// how far past expiry we are (daysExpired > 0 once lapsed).
	daysExpired := -daysUntil
	lines := []domainInvLine{{
		descEN: fmt.Sprintf("Domain renewal: %s (1 year)", domainName),
		descTH: fmt.Sprintf("ต่ออายุโดเมน: %s (1 ปี)", domainName),
		cents:  int64(renewTHB) * 100,
	}}
	recovery := "" // note suffix describing the recovery tier, if any
	if daysExpired > 0 {
		// Grace tier: 1..graceDays past expiry. Redemption tier: beyond
		// graceDays (up to graceDays+redemptionDays). Fees compound.
		if graceFeeTHB > 0 {
			lines = append(lines, domainInvLine{
				descEN: fmt.Sprintf("Late renewal (grace period) fee: %s", domainName),
				descTH: fmt.Sprintf("ค่าธรรมเนียมต่ออายุล่าช้า (ช่วงผ่อนผัน): %s", domainName),
				cents:  int64(graceFeeTHB) * 100,
			})
		}
		// Label by the actual tier (days past expiry), not by whether a fee
		// line happened to be added — a TLD can be in redemption with a zero
		// redemption fee and must still read as "redemption".
		if daysExpired > graceDays {
			if redemptionFeeTHB > 0 {
				lines = append(lines, domainInvLine{
					descEN: fmt.Sprintf("Redemption recovery fee: %s", domainName),
					descTH: fmt.Sprintf("ค่าธรรมเนียมกู้คืนโดเมน (redemption): %s", domainName),
					cents:  int64(redemptionFeeTHB) * 100,
				})
			}
			recovery = fmt.Sprintf(" — REDEMPTION recovery, %d day(s) past expiry", daysExpired)
		} else {
			recovery = fmt.Sprintf(" — grace-period renewal, %d day(s) past expiry", daysExpired)
		}
	}

	var subtotal int64
	for _, l := range lines {
		subtotal += l.cents
	}

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)

	var seq int64
	if err := tx.QueryRow(ctx, `SELECT nextval('invoice_number_seq')`).Scan(&seq); err != nil {
		return false, err
	}
	invNumber := fmt.Sprintf("INV-%d-%06d", time.Now().Year(), seq)

	const vatBP = 700
	vat := subtotal * vatBP / 10000
	total := subtotal + vat

	var invID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO invoices (
			invoice_number, customer_id, status, currency,
			subtotal_cents, vat_rate_bp, vat_cents, total_cents,
			issue_date, due_date, notes
		) VALUES ($1,$2,'issued','THB',$3,$4,$5,$6,
		          CURRENT_DATE, CURRENT_DATE + INTERVAL '7 days', $7)
		RETURNING id`,
		invNumber, customerID, subtotal, vatBP, vat, total,
		fmt.Sprintf("Auto-issued domain renewal for %s (expires %s)%s", domainName, expiryDate, recovery)).
		Scan(&invID); err != nil {
		return false, err
	}

	for i, l := range lines {
		if _, err := tx.Exec(ctx, `
			INSERT INTO invoice_items (
				invoice_id, product_type, product_ref, description_en, description_th,
				quantity, unit_price_cents, total_cents, sort_order
			) VALUES ($1, 'domain', $2, $3, $4, 1, $5, $5, $6)`,
			invID, domainID, l.descEN, l.descTH, l.cents, i); err != nil {
			return false, err
		}
	}

	// Stamp the invoice guard inside the same tx so a crash between
	// commit and stamp can't double-invoice.
	if _, err := tx.Exec(ctx, `
		INSERT INTO renewal_reminders (entity_type, entity_id, due_date, offset_days, template_used)
		VALUES ('domain', $1, $2::date, $3, 'domain_renewal_invoice')
		ON CONFLICT (entity_type, entity_id, due_date, offset_days) DO NOTHING`,
		domainID, expiryDate, domainStampInvoiced); err != nil {
		return false, err
	}

	if err := tx.Commit(ctx); err != nil {
		return false, err
	}

	// Notify the billing contact that the invoice is ready (reuse the
	// standard invoice_issued template).
	if to, locale := lookupBillingContact(ctx, s.DB, customerID); to != "" {
		portalLink := strings.TrimRight(s.Cfg.PortalBaseURL, "/") + "/portal/billing/" + invID
		s.Notify.Send(notify.Job{
			Template:  "invoice_issued",
			ToAddress: to,
			Locale:    locale,
			Payload: map[string]any{
				"invoice_number": invNumber,
				"amount":         fmt.Sprintf("%.2f", float64(total)/100.0),
				"currency":       "THB",
				"portal_link":    portalLink,
			},
		})
	}
	return true, nil
}
