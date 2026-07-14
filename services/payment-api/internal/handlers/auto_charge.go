package handlers

import (
	"context"
	"errors"
	"log"
)

// errAutoChargeNotWired marks the boundary where a real provider
// recurring-charge call must be implemented. Until then, auto_charge
// subscriptions gracefully fall back to notify+invoice (the invoice is
// already issued and emailed by the time this runs).
var errAutoChargeNotWired = errors.New("auto-charge: provider recurring-charge not configured")

// attemptAutoCharge tries to settle a freshly-generated subscription
// invoice against a vaulted payment method, when the subscription opted in
// (subscriptions.auto_charge + an active payment_methods_vault row). It is
// best-effort: nothing here blocks invoice generation, and a subscription
// that hasn't opted in simply falls through to the normal notify+invoice
// flow.
func (s *Scheduler) attemptAutoCharge(ctx context.Context, subID, invoiceID string) {
	var autoCharge bool
	var provider, agreementID, methodStatus *string
	err := s.DB.QueryRow(ctx, `
		SELECT sub.auto_charge, v.provider, v.agreement_id, v.status
		  FROM subscriptions sub
		  LEFT JOIN payment_methods_vault v ON v.id = sub.payment_method_id
		 WHERE sub.id = $1`, subID).Scan(&autoCharge, &provider, &agreementID, &methodStatus)
	if err != nil {
		log.Printf("auto-charge: lookup %s: %v", subID, err)
		return
	}
	if !autoCharge || agreementID == nil || methodStatus == nil || *methodStatus != "active" {
		return // not opted in / no usable method → notify+invoice as normal
	}

	if err := s.chargeAgreement(ctx, *provider, *agreementID, invoiceID); err != nil {
		log.Printf("auto-charge: invoice %s via %s: %v (falling back to notify+invoice)",
			invoiceID, *provider, err)
	}
}

// chargeAgreement is the single implementation point for provider-side
// recurring capture. Wire the real call here — e.g. a PayPal reference
// transaction against agreementID for the invoice total, then on success
// insert a payment row and mark the invoice paid. It requires live PayPal
// Billing Agreement credentials (see migration 063_auto_charge.sql); until
// that is configured it returns errAutoChargeNotWired and the caller falls
// back to notify+invoice.
func (s *Scheduler) chargeAgreement(ctx context.Context, provider, agreementID, invoiceID string) error {
	_ = ctx
	_ = provider
	_ = agreementID
	_ = invoiceID
	return errAutoChargeNotWired
}
