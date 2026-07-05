package handlers

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

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
	if n, err := s.generateSubscriptionInvoices(ctx); err != nil {
		log.Printf("scheduler generateSubscriptionInvoices: %v", err)
	} else if n > 0 {
		log.Printf("scheduler: generated %d subscription invoice(s)", n)
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
		       to_char(last_billed_on,'YYYY-MM-DD')
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
		nextBilling, lastBilled                         *string
	}
	var subs []sub
	for rows.Next() {
		var x sub
		if err := rows.Scan(&x.id, &x.customerID, &x.title, &x.product, &x.ref,
			&x.cycle, &x.amount, &x.currency, &x.nextBilling, &x.lastBilled); err != nil {
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
		if err := s.issueSubscriptionInvoice(ctx, x.id, x.customerID, x.title,
			x.product, x.ref, x.amount, x.currency, x.cycle, *x.nextBilling); err != nil {
			log.Printf("scheduler: subscription %s: %v", x.id, err)
			continue
		}
		count++
	}
	return count, nil
}

func (s *Scheduler) issueSubscriptionInvoice(ctx context.Context,
	subID, customerID, title, productType string, productRef *string,
	amount int64, currency, cycle, billingDate string) error {

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var seq int64
	if err := tx.QueryRow(ctx, `SELECT nextval('invoice_number_seq')`).Scan(&seq); err != nil {
		return err
	}
	invNumber := fmt.Sprintf("INV-%d-%06d", time.Now().Year(), seq)

	const vatBP = 700
	vat := amount * vatBP / 10000
	total := amount + vat

	var invID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO invoices (
			invoice_number, customer_id, subscription_id, status, currency,
			subtotal_cents, vat_rate_bp, vat_cents, total_cents,
			issue_date, due_date, notes
		) VALUES ($1,$2,$3,'issued',$4,$5,$6,$7,$8,
		          $9::date, $9::date + INTERVAL '7 days',
		          'Auto-issued by subscription scheduler')
		RETURNING id`,
		invNumber, customerID, subID, currency,
		amount, vatBP, vat, total, billingDate).Scan(&invID); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO invoice_items (
			invoice_id, product_type, product_ref, description_en, description_th,
			quantity, unit_price_cents, total_cents, sort_order
		) VALUES ($1, $2, $3, $4, $5, 1, $6, $6, 0)`,
		invID, productType, productRef, title, title, amount); err != nil {
		return err
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
	return nil
}

func cycleInterval(cycle string) string {
	switch cycle {
	case "monthly":
		return "1 month"
	case "quarterly":
		return "3 months"
	case "annually":
		return "1 year"
	}
	return "1 month"
}

func lookupBillingContact(ctx context.Context, db *pgxpool.Pool, customerID string) (to, locale string) {
	locale = "en"
	// Prefer billing_email from the billing profile, then primary contact.
	if err := db.QueryRow(ctx, `
		SELECT COALESCE(p.billing_email, cc.email),
		       COALESCE(cc.locale,'en')
		  FROM customers c
		  LEFT JOIN customer_billing_profiles p ON p.customer_id = c.id
		  LEFT JOIN customer_contacts cc ON cc.customer_id = c.id AND cc.is_primary = true
		 WHERE c.id = $1`, customerID).Scan(&to, &locale); err != nil {
		return "", "en"
	}
	return to, locale
}
