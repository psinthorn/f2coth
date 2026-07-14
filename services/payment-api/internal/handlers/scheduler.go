package handlers

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/f2cothai/f2-website/services/payment-api/internal/config"
	"github.com/f2cothai/f2-website/services/payment-api/internal/notify"
)

// Scheduler is a single goroutine that periodically:
//  1. flips issued/partially_paid invoices to 'overdue' when due_date
//     < CURRENT_DATE and dispatches a reminder email
//  2. generates the next invoice from each active subscription when
//     next_billing_at is within the LeadDays window, and advances the
//     subscription's next_billing_at to the next cycle
//
// Both operations are best-effort and idempotent: re-running won't
// double-issue an invoice (we check last_billed_on) or send duplicate
// reminders (we stamp metadata.overdue_reminder_sent_on).
//
// Tick cadence is 5 minutes. Tunable through the constructor.
type Scheduler struct {
	DB       *pgxpool.Pool
	Cfg      config.Config
	Notify   *notify.Client
	Tick     time.Duration
	LeadDays int // generate invoices N days before next_billing_at
	stopCh   chan struct{}
}

func NewScheduler(db *pgxpool.Pool, cfg config.Config, n *notify.Client) *Scheduler {
	return &Scheduler{
		DB:       db,
		Cfg:      cfg,
		Notify:   n,
		Tick:     5 * time.Minute,
		LeadDays: 7,
		stopCh:   make(chan struct{}),
	}
}

func (s *Scheduler) Start() {
	go s.loop()
}

func (s *Scheduler) Stop() { close(s.stopCh) }

func (s *Scheduler) loop() {
	log.Printf("payment-api scheduler: started, tick=%s leadDays=%d", s.Tick, s.LeadDays)
	t := time.NewTicker(s.Tick)
	defer t.Stop()
	// Run once immediately so a freshly restarted service catches up.
	s.runOnce()
	for {
		select {
		case <-s.stopCh:
			log.Print("payment-api scheduler: stopping")
			return
		case <-t.C:
			s.runOnce()
		}
	}
}

func (s *Scheduler) runOnce() {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	if n, err := s.markOverdue(ctx); err != nil {
		log.Printf("scheduler markOverdue: %v", err)
	} else if n > 0 {
		log.Printf("scheduler: marked %d invoice(s) overdue", n)
	}
	if n, err := s.dispatchRenewalReminders(ctx); err != nil {
		log.Printf("scheduler dispatchRenewalReminders: %v", err)
	} else if n > 0 {
		log.Printf("scheduler: dispatched %d renewal reminder(s)", n)
	}
	if n, err := s.generateSubscriptionInvoices(ctx); err != nil {
		log.Printf("scheduler generateSubscriptionInvoices: %v", err)
	} else if n > 0 {
		log.Printf("scheduler: generated %d subscription invoice(s)", n)
	}
	if n, err := s.dispatchDomainRenewals(ctx); err != nil {
		log.Printf("scheduler dispatchDomainRenewals: %v", err)
	} else if n > 0 {
		log.Printf("scheduler: processed %d domain renewal(s)", n)
	}
	if n, err := s.dispatchDunning(ctx); err != nil {
		log.Printf("scheduler dispatchDunning: %v", err)
	} else if n > 0 {
		log.Printf("scheduler: dispatched %d dunning reminder(s)", n)
	}
	if n, err := s.suspendUnpaidServices(ctx); err != nil {
		log.Printf("scheduler suspendUnpaidServices: %v", err)
	} else if n > 0 {
		log.Printf("scheduler: suspended services for %d invoice(s)", n)
	}
}

// suspendUnpaidServices walks invoices that received dunning level 3
// at least 14 days ago and are still 'overdue', then suspends every
// service tied to the invoice. Idempotent via UNIQUE(invoice_id,
// product_type, product_ref) on service_suspensions.
//
// Service mapping:
//   - invoice.subscription_id → suspend that subscription
//   - invoice_items where product_type IN ('hosting','sla') with a
//     product_ref → suspend that resource
//
// Domains can't really be "un-registered" so we skip product_type
// 'domain' — admin gets the internal alert and can decide.
func (s *Scheduler) suspendUnpaidServices(ctx context.Context) (int, error) {
	rows, err := s.DB.Query(ctx, `
		SELECT i.id, i.invoice_number, i.customer_id, c.name,
		       i.currency, i.total_cents - i.amount_paid_cents AS due,
		       (CURRENT_DATE - i.due_date)::int AS days_overdue,
		       i.subscription_id
		  FROM invoices i
		  JOIN customers c ON c.id = i.customer_id
		  JOIN dunning_reminders d ON d.invoice_id = i.id AND d.reminder_level = 3
		 WHERE i.status = 'overdue'
		   AND d.sent_at < NOW() - INTERVAL '14 days'
		   AND NOT EXISTS (
		     SELECT 1 FROM service_suspensions ss
		      WHERE ss.invoice_id = i.id AND ss.status = 'active'
		   )`)
	if err != nil {
		return 0, err
	}
	type target struct {
		invID, number, customerID, customer, currency string
		due                                           int64
		daysOverdue                                   int
		subscriptionID                                *string
	}
	var batch []target
	for rows.Next() {
		var t target
		if err := rows.Scan(&t.invID, &t.number, &t.customerID, &t.customer,
			&t.currency, &t.due, &t.daysOverdue, &t.subscriptionID); err != nil {
			rows.Close()
			return 0, err
		}
		batch = append(batch, t)
	}
	rows.Close()

	suspended := 0
	for _, t := range batch {
		count, list, err := s.suspendForInvoice(ctx, t.invID, t.customerID, t.subscriptionID)
		if err != nil {
			log.Printf("scheduler: suspend invoice %s: %v", t.invID, err)
			continue
		}
		if count == 0 {
			continue
		}
		suspended++

		// Notify customer.
		if to, locale := lookupBillingContact(ctx, s.DB, t.customerID); to != "" {
			portalLink := strings.TrimRight(s.Cfg.PortalBaseURL, "/") + "/portal/billing/" + t.invID
			s.Notify.Send(notify.Job{
				Template:  "service_suspended_customer",
				ToAddress: to,
				Locale:    locale,
				Payload: map[string]any{
					"customer_name":  t.customer,
					"invoice_number": t.number,
					"amount":         fmt.Sprintf("%.2f", float64(t.due)/100.0),
					"currency":       t.currency,
					"days_overdue":   t.daysOverdue,
					"service_count":  count,
					"service_list":   list,
					"portal_link":    portalLink,
				},
			})
		}
		// Notify billing team.
		if s.Cfg.BillingNotifyTo != "" {
			adminLink := strings.TrimRight(s.Cfg.AdminBaseURL, "/") + "/admin/invoices/" + t.invID
			s.Notify.Send(notify.Job{
				Template:  "services_suspended_internal",
				ToAddress: s.Cfg.BillingNotifyTo,
				Payload: map[string]any{
					"customer_name":  t.customer,
					"invoice_number": t.number,
					"amount":         fmt.Sprintf("%.2f", float64(t.due)/100.0),
					"currency":       t.currency,
					"days_overdue":   t.daysOverdue,
					"service_count":  count,
					"service_list":   list,
					"admin_link":     adminLink,
				},
			})
		}
	}
	return suspended, nil
}

// suspendForInvoice does the per-invoice suspension transaction:
// inserts service_suspensions rows + flips underlying resources.
// Returns the count of newly-suspended resources and a bullet-list
// string for the notification template.
func (s *Scheduler) suspendForInvoice(ctx context.Context,
	invoiceID, customerID string, subscriptionID *string) (int, string, error) {

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return 0, "", err
	}
	defer tx.Rollback(ctx)

	var lines []string
	count := 0

	// 1. Invoice-level subscription (set by the scheduler when it
	// auto-generated the invoice from a subscription).
	if subscriptionID != nil && *subscriptionID != "" {
		ok, _, err := suspendOne(ctx, tx, invoiceID, customerID, "subscription", subscriptionID)
		if err != nil {
			return 0, "", err
		}
		if ok {
			var title string
			_ = tx.QueryRow(ctx, `SELECT title FROM subscriptions WHERE id=$1`, *subscriptionID).Scan(&title)
			lines = append(lines, "  • Subscription: "+title)
			count++
		}
	}

	// 2. Line-item resources (hosting plans, SLA contracts).
	itemRows, err := tx.Query(ctx, `
		SELECT product_type, product_ref, description_en
		  FROM invoice_items
		 WHERE invoice_id=$1 AND product_ref IS NOT NULL`, invoiceID)
	if err != nil {
		return 0, "", err
	}
	type item struct {
		productType, desc string
		productRef        *string
	}
	var items []item
	for itemRows.Next() {
		var it item
		if err := itemRows.Scan(&it.productType, &it.productRef, &it.desc); err != nil {
			itemRows.Close()
			return 0, "", err
		}
		items = append(items, it)
	}
	itemRows.Close()

	for _, it := range items {
		switch it.productType {
		case "hosting", "sla", "msp":
			ok, _, err := suspendOne(ctx, tx, invoiceID, customerID, it.productType, it.productRef)
			if err != nil {
				return 0, "", err
			}
			if ok {
				lines = append(lines, "  • "+it.desc)
				count++
			}
			// 'domain' and 'custom' are intentionally not auto-suspended.
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, "", err
	}
	list := strings.Join(lines, "\n")
	if list == "" {
		list = "  (no services tied to this invoice)"
	}
	return count, list, nil
}

// dispatchRenewalReminders sends WHMCS-style *advance* renewal heads-ups
// for active subscriptions approaching next_billing_at, at the day-before
// tiers in Cfg.RenewalReminderOffsets (default 30 & 14 days). This covers
// the window before generateSubscriptionInvoices() issues the invoice at
// LeadDays (7) out, so nothing overlaps the invoice_issued email.
//
// Idempotency + no-spam rules (renewal_reminders stamps, keyed by
// entity + due_date + offset tier):
//   - At most ONE customer email per subscription per tick: we pick the
//     smallest OPEN unsent tier (offset >= days_until — the most relevant
//     message right now) and stamp every larger open tier as superseded,
//     so a subscription first observed deep inside the window doesn't get
//     several tiers at once.
//   - One internal billing-team heads-up per renewal cycle, stamped under
//     the sentinel offset 0.
func (s *Scheduler) dispatchRenewalReminders(ctx context.Context) (int, error) {
	offsets := s.Cfg.RenewalReminderOffsets // descending, positive, de-duped
	if len(offsets) == 0 {
		return 0, nil // pass disabled
	}
	maxOffset := offsets[0]

	// Lower bound excludes the invoice-generation lead window: once a
	// subscription is within LeadDays of billing, generateSubscriptionInvoices
	// issues the invoice + invoice_issued email, so an advance reminder there
	// would double up. Reminders only fire strictly outside that window.
	rows, err := s.DB.Query(ctx, `
		SELECT sub.id, sub.customer_id, c.name, sub.title,
		       sub.billing_cycle, sub.amount_cents, sub.currency,
		       to_char(sub.next_billing_at, 'YYYY-MM-DD') AS renewal_date,
		       (sub.next_billing_at - CURRENT_DATE)::int   AS days_until
		  FROM subscriptions sub
		  JOIN customers c ON c.id = sub.customer_id
		 WHERE sub.status = 'active'
		   AND sub.next_billing_at > CURRENT_DATE + ($2::int * INTERVAL '1 day')
		   AND sub.next_billing_at <= CURRENT_DATE + ($1::int * INTERVAL '1 day')`,
		maxOffset, s.LeadDays)
	if err != nil {
		return 0, err
	}
	type sub struct {
		id, customerID, customer, title, cycle, currency, renewalDate string
		amount                                                        int64
		daysUntil                                                     int
	}
	var subs []sub
	for rows.Next() {
		var x sub
		if err := rows.Scan(&x.id, &x.customerID, &x.customer, &x.title,
			&x.cycle, &x.amount, &x.currency, &x.renewalDate, &x.daysUntil); err != nil {
			rows.Close()
			return 0, err
		}
		subs = append(subs, x)
	}
	rows.Close()

	sent := 0
	for _, x := range subs {
		// Which tiers (incl. sentinel 0) already fired for this cycle?
		alreadySent, err := s.sentRenewalOffsets(ctx, "subscription", x.id, x.renewalDate)
		if err != nil {
			log.Printf("scheduler: renewal stamps %s: %v", x.id, err)
			continue
		}

		// Pick the smallest OPEN unsent tier (offset >= days_until). Open
		// tiers larger than it are stale → stamp them superseded so they
		// never fire late.
		chosen := -1
		for i := len(offsets) - 1; i >= 0; i-- { // ascending
			o := offsets[i]
			if o < x.daysUntil {
				continue // window not open yet
			}
			if !alreadySent[o] {
				chosen = o
				break
			}
		}
		if chosen == -1 {
			continue // nothing due this tick
		}

		amountStr := fmt.Sprintf("%.2f", float64(x.amount)/100.0)

		// Internal billing-team heads-up — once per cycle (sentinel 0).
		// Independent of the customer contact (goes to BillingNotifyTo).
		if s.Cfg.BillingNotifyTo != "" && !alreadySent[0] {
			adminLink := strings.TrimRight(s.Cfg.AdminBaseURL, "/") + "/admin/subscriptions"
			s.Notify.Send(notify.Job{
				Template:  "service_renewal_upcoming_internal",
				ToAddress: s.Cfg.BillingNotifyTo,
				Payload: map[string]any{
					"customer_name": x.customer,
					"service_name":  x.title,
					"amount":        amountStr,
					"currency":      x.currency,
					"billing_cycle": x.cycle,
					"renewal_date":  x.renewalDate,
					"days_until":    x.daysUntil,
					"admin_link":    adminLink,
				},
			})
			s.stampRenewal(ctx, "subscription", x.id, x.renewalDate, 0, "service_renewal_upcoming_internal")
			alreadySent[0] = true
		}

		// Customer heads-up. Only stamp the customer tiers when we actually
		// have a recipient — otherwise the stamp would permanently suppress
		// the notice for a customer whose contact email is added later.
		to, locale := lookupBillingContact(ctx, s.DB, x.customerID)
		if to == "" {
			continue
		}
		portalLink := strings.TrimRight(s.Cfg.PortalBaseURL, "/") + "/portal/billing"
		s.Notify.Send(notify.Job{
			Template:  "service_renewal_upcoming",
			ToAddress: to,
			Locale:    locale,
			Payload: map[string]any{
				"customer_name": x.customer,
				"service_name":  x.title,
				"amount":        amountStr,
				"currency":      x.currency,
				"billing_cycle": x.cycle,
				"renewal_date":  x.renewalDate,
				"days_until":    x.daysUntil,
				"portal_link":   portalLink,
			},
		})

		// Stamp the tier we sent plus any larger open tiers (superseded).
		for _, o := range offsets { // descending
			if o < chosen || o < x.daysUntil || alreadySent[o] {
				continue
			}
			s.stampRenewal(ctx, "subscription", x.id, x.renewalDate, o, "service_renewal_upcoming")
			alreadySent[o] = true
		}
		sent++
	}
	return sent, nil
}

// sentRenewalOffsets returns the set of offset tiers already stamped for a
// given entity + renewal date (0 = internal sentinel).
func (s *Scheduler) sentRenewalOffsets(ctx context.Context,
	entityType, entityID, dueDate string) (map[int]bool, error) {
	out := map[int]bool{}
	rows, err := s.DB.Query(ctx, `
		SELECT offset_days FROM renewal_reminders
		 WHERE entity_type=$1 AND entity_id=$2 AND due_date=$3::date`,
		entityType, entityID, dueDate)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var o int
		if err := rows.Scan(&o); err != nil {
			return nil, err
		}
		out[o] = true
	}
	return out, rows.Err()
}

// stampRenewal records an idempotency stamp; conflicts are no-ops so
// re-running the loop never double-sends.
func (s *Scheduler) stampRenewal(ctx context.Context,
	entityType, entityID, dueDate string, offset int, template string) {
	if _, err := s.DB.Exec(ctx, `
		INSERT INTO renewal_reminders (entity_type, entity_id, due_date, offset_days, template_used)
		VALUES ($1, $2, $3::date, $4, $5)
		ON CONFLICT (entity_type, entity_id, due_date, offset_days) DO NOTHING`,
		entityType, entityID, dueDate, offset, template); err != nil {
		log.Printf("renewal stamp: %v", err)
	}
}

// dunningLevel encodes the cadence: each row says "an invoice that's
// been overdue for at least DaysOverdue and hasn't yet received a
// reminder at this Level → send this Template". Internal flag marks
// the escalation that goes to the billing team instead of the customer.
type dunningLevel struct {
	Level       int
	DaysOverdue int
	Template    string
	Internal    bool
}

var dunningSchedule = []dunningLevel{
	{Level: 1, DaysOverdue: 1, Template: "invoice_reminder_friendly"},
	{Level: 2, DaysOverdue: 7, Template: "invoice_reminder_firm"},
	{Level: 3, DaysOverdue: 14, Template: "invoice_reminder_final"},
	{Level: 4, DaysOverdue: 30, Template: "invoice_escalation_internal", Internal: true},
}

// dispatchDunning sends the next reminder for every overdue invoice
// whose accrued days_overdue is past the next-step threshold and which
// hasn't already received that reminder. Idempotent via
// UNIQUE(invoice_id, reminder_level) in dunning_reminders.
func (s *Scheduler) dispatchDunning(ctx context.Context) (int, error) {
	sent := 0
	for _, lvl := range dunningSchedule {
		rows, err := s.DB.Query(ctx, `
			SELECT i.id, i.invoice_number, i.total_cents, i.amount_paid_cents,
			       i.currency, i.customer_id, c.name,
			       (CURRENT_DATE - i.due_date)::int AS days_overdue
			  FROM invoices i
			  JOIN customers c ON c.id = i.customer_id
			 WHERE i.status = 'overdue'
			   AND (CURRENT_DATE - i.due_date) >= $1
			   AND NOT EXISTS (
			     SELECT 1 FROM dunning_reminders d
			      WHERE d.invoice_id = i.id AND d.reminder_level = $2
			   )`,
			lvl.DaysOverdue, lvl.Level)
		if err != nil {
			return sent, err
		}
		type row struct {
			id, number, currency, customerID, customerName string
			due                                            int64
			daysOverdue                                    int
		}
		var batch []row
		for rows.Next() {
			var r row
			var total, paid int64
			if err := rows.Scan(&r.id, &r.number, &total, &paid,
				&r.currency, &r.customerID, &r.customerName, &r.daysOverdue); err != nil {
				rows.Close()
				return sent, err
			}
			r.due = total - paid
			batch = append(batch, r)
		}
		rows.Close()

		for _, r := range batch {
			to, locale := "", "en"
			if !lvl.Internal {
				to, locale = lookupBillingContact(ctx, s.DB, r.customerID)
				if to == "" {
					continue
				}
			} else {
				to = s.Cfg.BillingNotifyTo
				if to == "" {
					continue
				}
			}

			portalLink := strings.TrimRight(s.Cfg.PortalBaseURL, "/") + "/portal/billing/" + r.id
			adminLink := strings.TrimRight(s.Cfg.AdminBaseURL, "/") + "/admin/invoices/" + r.id

			s.Notify.Send(notify.Job{
				Template:  lvl.Template,
				ToAddress: to,
				Locale:    locale,
				Payload: map[string]any{
					"invoice_number": r.number,
					"amount":         fmt.Sprintf("%.2f", float64(r.due)/100.0),
					"currency":       r.currency,
					"customer_name":  r.customerName,
					"days_overdue":   r.daysOverdue,
					"portal_link":    portalLink,
					"admin_link":     adminLink,
				},
			})

			// Stamp the reminder as sent so retries don't double-fire.
			if _, err := s.DB.Exec(ctx, `
				INSERT INTO dunning_reminders (invoice_id, reminder_level, template_used)
				VALUES ($1, $2, $3)
				ON CONFLICT (invoice_id, reminder_level) DO NOTHING`,
				r.id, lvl.Level, lvl.Template); err != nil {
				log.Printf("dunning stamp: %v", err)
				continue
			}
			sent++
		}
	}
	return sent, nil
}

// markOverdue flips eligible invoices to 'overdue' and queues a
// reminder email. Stamps metadata.overdue_reminder_sent_on so the same
// invoice isn't reminded twice on the same day.
func (s *Scheduler) markOverdue(ctx context.Context) (int, error) {
	rows, err := s.DB.Query(ctx, `
		UPDATE invoices
		   SET status='overdue'
		 WHERE status IN ('issued','partially_paid')
		   AND due_date < CURRENT_DATE
		RETURNING id, invoice_number, total_cents, amount_paid_cents, currency, customer_id`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	n := 0
	type inv struct {
		id, number, currency, customerID string
		due                              int64
	}
	var out []inv
	for rows.Next() {
		var i inv
		var total, paid int64
		if err := rows.Scan(&i.id, &i.number, &total, &paid, &i.currency, &i.customerID); err != nil {
			return n, err
		}
		i.due = total - paid
		out = append(out, i)
		n++
	}
	rows.Close()

	// Reminder emails — separately from the flip, so a notify outage
	// doesn't stop status progression.
	for _, i := range out {
		to, locale := lookupBillingContact(ctx, s.DB, i.customerID)
		if to == "" {
			continue
		}
		portalLink := strings.TrimRight(s.Cfg.PortalBaseURL, "/") + "/portal/billing/" + i.id
		s.Notify.Send(notify.Job{
			Template:  "invoice_issued", // reuse — same payload shape
			ToAddress: to,
			Locale:    locale,
			Payload: map[string]any{
				"invoice_number": i.number,
				"amount":         fmt.Sprintf("%.2f", float64(i.due)/100.0),
				"currency":       i.currency,
				"portal_link":    portalLink,
			},
		})
	}
	return n, nil
}

// generateSubscriptionInvoices walks active subscriptions whose
// next_billing_at falls within the lead window, issues an invoice, and
// advances next_billing_at by one cycle. last_billed_on is the
// idempotency guard — we skip rows already billed on the same
// effective date.
func (s *Scheduler) generateSubscriptionInvoices(ctx context.Context) (int, error) {
	rows, err := s.DB.Query(ctx, `
		SELECT id, customer_id, title, product_type, product_ref,
		       billing_cycle, amount_cents, currency,
		       to_char(next_billing_at,'YYYY-MM-DD'),
		       to_char(last_billed_on,'YYYY-MM-DD'),
		       coupon_code,
		       (next_billing_at - CURRENT_DATE)::int
		  FROM subscriptions
		 WHERE status='active'
		   AND next_billing_at <= CURRENT_DATE + ($1::int * INTERVAL '1 day')`,
		s.LeadDays)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	type sub struct {
		id, customerID, title, product, cycle, currency string
		ref                                             *string
		amount                                          int64
		nextBilling, lastBilled, coupon                 *string
		daysUntil                                       int
	}
	var subs []sub
	for rows.Next() {
		var x sub
		if err := rows.Scan(&x.id, &x.customerID, &x.title, &x.product, &x.ref,
			&x.cycle, &x.amount, &x.currency, &x.nextBilling, &x.lastBilled, &x.coupon, &x.daysUntil); err != nil {
			return 0, err
		}
		subs = append(subs, x)
	}
	rows.Close()

	count := 0
	for _, x := range subs {
		if x.lastBilled != nil && x.nextBilling != nil && *x.lastBilled == *x.nextBilling {
			continue // already billed for this cycle
		}
		// Cycle-aware lead: never bill more than (cycle length − 1) days
		// ahead. Without this a weekly sub (7-day cycle) sits inside the
		// 7-day lead window even after advancing, so it re-bills every tick.
		if effLead := effectiveLead(s.LeadDays, x.cycle); x.daysUntil > effLead {
			continue
		}
		if err := s.issueSubscriptionInvoice(ctx, x.id, x.customerID, x.title,
			x.product, x.ref, x.amount, x.currency, x.cycle, *x.nextBilling, x.coupon); err != nil {
			log.Printf("scheduler: subscription %s: %v", x.id, err)
			continue
		}
		count++
	}
	return count, nil
}

// cycleDays is an approximate length of a billing cycle in days, used only
// to bound the invoice-generation lead so short cycles don't double-bill.
func cycleDays(cycle string) int {
	switch cycle {
	case "weekly":
		return 7
	case "monthly":
		return 30
	case "quarterly":
		return 91
	case "semiannually":
		return 182
	case "annually":
		return 365
	case "biennially":
		return 730
	case "triennially":
		return 1095
	}
	return 30
}

// effectiveLead caps the configured lead at cycle length − 1 day so a
// just-advanced subscription can't immediately re-enter the billing window.
func effectiveLead(lead int, cycle string) int {
	if cap := cycleDays(cycle) - 1; cap < lead {
		return cap
	}
	return lead
}

func (s *Scheduler) issueSubscriptionInvoice(ctx context.Context,
	subID, customerID, title, productType string, productRef *string,
	amount int64, currency, cycle, billingDate string, couponCode *string) error {

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Apply a coupon (if the subscription carries one). Discount reduces
	// the subtotal — invoice_items can't be negative — and is recorded in
	// coupon_redemptions + the invoice notes for audit.
	subtotal := amount
	notes := "Auto-issued by subscription scheduler"
	var couponID string
	var discount int64
	var couponContinuing bool
	if couponCode != nil && *couponCode != "" {
		// Has this subscription already redeemed this coupon in a prior
		// cycle? If so it keeps the discount without re-consuming the cap.
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS(
			  SELECT 1 FROM coupon_redemptions cr
			    JOIN coupons c ON c.id = cr.coupon_id
			   WHERE c.code = $1 AND cr.subscription_id = $2)`,
			*couponCode, subID).Scan(&couponContinuing); err != nil {
			return err
		}
		couponID, discount, err = evaluateCoupon(ctx, tx, *couponCode, "subscription", currency, amount, couponContinuing)
		if err != nil {
			return err
		}
		if discount > 0 {
			subtotal = amount - discount
			notes = fmt.Sprintf("%s · coupon %s applied (-%.2f %s)",
				notes, *couponCode, float64(discount)/100.0, currency)
		}
	}

	var seq int64
	if err := tx.QueryRow(ctx, `SELECT nextval('invoice_number_seq')`).Scan(&seq); err != nil {
		return err
	}
	invNumber := fmt.Sprintf("INV-%d-%06d", time.Now().Year(), seq)

	const vatBP = 700
	vat := subtotal * vatBP / 10000
	total := subtotal + vat

	var invID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO invoices (
			invoice_number, customer_id, subscription_id, status, currency,
			subtotal_cents, vat_rate_bp, vat_cents, total_cents,
			issue_date, due_date, notes
		) VALUES ($1,$2,$3,'issued',$4,$5,$6,$7,$8,
		          $9::date, $9::date + INTERVAL '7 days', $10)
		RETURNING id`,
		invNumber, customerID, subID, currency,
		subtotal, vatBP, vat, total, billingDate, notes).Scan(&invID); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO invoice_items (
			invoice_id, product_type, product_ref, description_en, description_th,
			quantity, unit_price_cents, total_cents, sort_order
		) VALUES ($1, $2, $3, $4, $5, 1, $6, $6, 0)`,
		invID, productType, productRef, title, title, subtotal); err != nil {
		return err
	}

	if discount > 0 {
		if err := recordCouponRedemption(ctx, tx, couponID, invID, customerID, subID, discount, !couponContinuing); err != nil {
			return err
		}
	}

	// Advance the subscription. last_billed_on = billingDate;
	// next_billing_at += cycle.
	if _, err := tx.Exec(ctx, `
		UPDATE subscriptions
		   SET last_billed_on = $1::date,
		       next_billing_at = $1::date + $2::interval
		 WHERE id = $3`,
		billingDate, cycleInterval(cycle), subID); err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}

	// Notify the billing contact.
	to, locale := lookupBillingContact(ctx, s.DB, customerID)
	if to != "" {
		portalLink := strings.TrimRight(s.Cfg.PortalBaseURL, "/") + "/portal/billing/" + invID
		s.Notify.Send(notify.Job{
			Template:  "invoice_issued",
			ToAddress: to,
			Locale:    locale,
			Payload: map[string]any{
				"invoice_number": invNumber,
				"amount":         fmt.Sprintf("%.2f", float64(total)/100.0),
				"currency":       currency,
				"portal_link":    portalLink,
			},
		})
	}

	// Opt-in card-on-file auto-charge (coexists with notify+invoice; a
	// no-op unless the subscription opted in and the provider is wired).
	s.attemptAutoCharge(ctx, subID, invID)
	return nil
}

func cycleInterval(cycle string) string {
	switch cycle {
	case "weekly":
		return "7 days"
	case "monthly":
		return "1 month"
	case "quarterly":
		return "3 months"
	case "semiannually":
		return "6 months"
	case "annually":
		return "1 year"
	case "biennially":
		return "2 years"
	case "triennially":
		return "3 years"
	}
	return "1 month"
}

// contactLookupSQL is the exact query lookupBillingContact runs. Kept as
// a package-level const so the regression test can assert the query never
// again references a non-existent column (like the historical is_primary
// bug this replaced). If you edit the SQL, update the tests too.
const contactLookupSQL = `
	SELECT
	  (SELECT billing_email FROM customer_billing_profiles WHERE customer_id = $1),
	  (SELECT email  FROM customer_contacts
	    WHERE customer_id = $1 AND role='owner' AND disabled_at IS NULL
	    ORDER BY created_at LIMIT 1),
	  (SELECT locale FROM customer_contacts
	    WHERE customer_id = $1 AND role='owner' AND disabled_at IS NULL
	    ORDER BY created_at LIMIT 1),
	  (SELECT email  FROM customer_contacts
	    WHERE customer_id = $1 AND disabled_at IS NULL
	    ORDER BY (role='owner') DESC, created_at LIMIT 1),
	  (SELECT locale FROM customer_contacts
	    WHERE customer_id = $1 AND disabled_at IS NULL
	    ORDER BY (role='owner') DESC, created_at LIMIT 1)`

// contactQuerier is the tiny subset of pgxpool.Pool / pgx.Tx that
// lookupBillingContact needs. Accepting the interface lets integration
// tests pass a transaction they then roll back, so tests never leak DB
// fixtures.
type contactQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// lookupBillingContact resolves the recipient email for billing
// correspondence to a customer. Resolution order (any hit wins):
//   1. customer_billing_profiles.billing_email (authoritative — set
//      explicitly by admin in /admin/customers/:id billing profile)
//   2. customer_contacts.email where role='owner' and not disabled
//      (portal-account owner; the schema has NO is_primary column —
//      role='owner' is how migration 009 models the account owner)
//   3. earliest non-disabled contact (falls back to any member)
// Returns "" if none resolve — the caller treats "" as skip-email.
func lookupBillingContact(ctx context.Context, db contactQuerier, customerID string) (to, locale string) {
	locale = "en"
	var billingEmail, ownerEmail, ownerLocale, memberEmail, memberLocale *string
	if err := db.QueryRow(ctx, contactLookupSQL, customerID).
		Scan(&billingEmail, &ownerEmail, &ownerLocale, &memberEmail, &memberLocale); err != nil {
		return "", "en"
	}
	switch {
	case billingEmail != nil && *billingEmail != "":
		to = *billingEmail
		if ownerLocale != nil {
			locale = *ownerLocale
		}
	case ownerEmail != nil && *ownerEmail != "":
		to = *ownerEmail
		if ownerLocale != nil {
			locale = *ownerLocale
		}
	case memberEmail != nil && *memberEmail != "":
		to = *memberEmail
		if memberLocale != nil {
			locale = *memberLocale
		}
	}
	return to, locale
}
