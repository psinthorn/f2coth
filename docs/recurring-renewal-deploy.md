# Recurring Renewal System — Deploy Runbook

Rollout for the renewal system (PR: `feat/recurring-renewal-system`, migrations
057–064). **The whole point of the staging below is that no customer receives an
email or invoice until you have deliberately turned that layer on and watched it.**
The scheduler runs `runOnce()` immediately on payment-api startup and every 5 min
after — so whatever is enabled at boot acts on the first tick.

Tick a box as you go. Stages 1–4 are gated: don't advance until the previous
stage looks right.

---

## Stage 0 — Land the code, change no behavior

Deploy the schema + UI + review fixes with every **new** email/invoice/sync
pass disabled. Existing invoicing/dunning is unchanged by this PR.

**Set these env vars BEFORE restarting payment-api / reseller-api:**

| Service | Var | Stage-0 value | Purpose |
|---|---|---|---|
| payment-api | `RENEWAL_REMINDER_OFFSETS` | *(empty)* | disables subscription reminders |
| payment-api | `DOMAIN_RENEWAL_NOTICE_OFFSETS` | *(empty)* | disables domain notices |
| payment-api | `DOMAIN_RENEWAL_INVOICE_LEAD` | `0` | disables domain auto-invoicing |
| reseller-api | `RESELLER_SYNC_MODE` | `off` | disables registrar sync |

Steps:

- [ ] **Back up the database** (or confirm the automated snapshot is recent).
- [ ] **Merge the PR** and pull the release commit onto the deploy host.
- [ ] **Apply migrations**: `make migrate` — applies 057→064. They are additive
      (`ADD COLUMN IF NOT EXISTS`, new tables) and re-runnable.
- [ ] **Verify migrations landed**:
      ```sql
      SELECT to_regclass('public.renewal_reminders'),
             to_regclass('public.coupons'),
             to_regclass('public.payment_methods_vault');
      SELECT count(*) FROM notification_templates
       WHERE code IN ('service_renewal_upcoming','domain_renewal_upcoming',
                      'domain_expired','domain_sync_drift');   -- expect 4+
      ```
- [ ] **Confirm SMTP is live** — notification-api must be running with a working
      SMTP config (check `/admin/settings/smtp`). The renewal templates are
      seeded by the migrations; delivery still needs SMTP.
- [ ] **Restart services**: `payment-api`, `cms-api`, `reseller-api`,
      `customer-api`, and **rebuild/redeploy `web-app`** (new admin/portal pages,
      nav, i18n, API clients).
- [ ] **Smoke-check the UI**:
  - [ ] `/admin/features` lists the new modules: `api.domain_renewals`,
        `api.domain_sync`, `admin.coupons`, `admin.renewals`, `api.auto_charge`.
  - [ ] `/admin/renewals` loads (upcoming lists may be empty — fine).
  - [ ] `/admin/pricing` shows the Grace fee / Redemption fee columns.
  - [ ] `/portal/subscriptions` loads for a test customer.
- [ ] **Confirm the scheduler is inert**: payment-api log shows the scheduler
      started; with offsets empty and invoice lead 0 it should report 0
      reminders / 0 domain renewals.

**Pre-flight data audit — do this before Stage 1.** Know exactly what the first
enabled tick will touch:

```sql
-- Subscriptions that will get a reminder or invoice soon
SELECT id, title, billing_cycle, next_billing_at,
       (next_billing_at - CURRENT_DATE) AS days
  FROM subscriptions
 WHERE status='active' AND next_billing_at <= CURRENT_DATE + 60
 ORDER BY next_billing_at;

-- Domains the engine will notice/invoice soon
SELECT domain, registrar, auto_renew, expires_at,
       (expires_at::date - CURRENT_DATE) AS days
  FROM customer_domains
 WHERE expires_at IS NOT NULL AND expires_at::date <= CURRENT_DATE + 60
 ORDER BY expires_at;

-- Which domains lack a matching price row (renewal invoice will be skipped)
SELECT d.domain FROM customer_domains d
 WHERE NOT EXISTS (SELECT 1 FROM domain_pricing p
                    WHERE p.is_active AND lower(d.domain) LIKE '%.'||p.tld);
```

- [ ] Reviewed the audit output; no surprises (e.g. a test domain expiring
      tomorrow that would fire an "URGENT expired" email to a real customer).

---

## Stage 1 — Enable subscription + domain notices (email, no new charges)

- [ ] Set `RENEWAL_REMINDER_OFFSETS=30,14` and
      `DOMAIN_RENEWAL_NOTICE_OFFSETS=60,30,7`; leave
      `DOMAIN_RENEWAL_INVOICE_LEAD=0` (still no domain invoices).
- [ ] Restart payment-api.
- [ ] Watch the log for `dispatched N renewal reminder(s)` /
      `processed N domain renewal(s)` and confirm N matches the audit.
- [ ] Confirm the billing team received the internal heads-up
      (`BILLING_NOTIFY_TO`), and spot-check one customer-facing email.
- [ ] Let it run a day; check `/admin/renewals` → reminder log.

## Stage 2 — Enable domain auto-invoicing

- [ ] Set `DOMAIN_RENEWAL_INVOICE_LEAD=14` (defaults for
      `DOMAIN_POST_EXPIRY_NOTICE_DAYS=1`, `DOMAIN_MAX_RECOVERY_DAYS=45`).
- [ ] Restart payment-api.
- [ ] After the next tick, verify a renewal invoice was auto-issued for a
      due domain, priced from `domain_pricing.renew_price_thb` (+ grace/
      redemption if lapsed), and the customer got the invoice email.
- [ ] Confirm grace/redemption values on `domain_pricing` are correct for your
      TLDs (migration 060 seeds ResellerClub gTLDs; refine per-TLD via a
      follow-up migration — pricing is edit-via-migration by design).

## Stage 3 — Registrar sync (ResellerClub), notify first

- [ ] Set `RESELLERCLUB_AUTH_USERID` / `RESELLERCLUB_API_KEY` (+ `NOTIFICATION_API_URL`,
      `BILLING_NOTIFY_TO`, `ADMIN_BASE_URL`) on reseller-api.
- [ ] Set `RESELLER_SYNC_MODE=notify` (keep `RESELLER_SYNC_INTERVAL=24h`,
      `RESELLER_SYNC_BATCH=50`). Restart reseller-api.
- [ ] Watch for `domain sync: reconciled N` and any `domain_sync_drift` alerts
      to the billing team. **Notify mode never writes `expires_at`** — it only
      reports where the registry disagrees with our record.
- [ ] Once the drift alerts look correct (dates match reality), set
      `RESELLER_SYNC_MODE=write` and restart. Now expiry auto-reconciles.
      *(.th domains stay manual — THNIC has no wired API.)*

## Stage 4 — (Optional) Auto-charge

Only if the business wants card-on-file recurring charging (this PR keeps
notify+invoice as the default and leaves the provider capture stubbed).

- [ ] Wire PayPal Billing Agreements + implement `chargeAgreement` in
      `auto_charge.go` (see the marked boundary), then enable per-subscription
      via `subscriptions.auto_charge` + a `payment_methods_vault` row.
- [ ] Enable the `api.auto_charge` module in `/admin/features`.

---

## Kill switches (no redeploy of code needed)

| To stop… | Do this |
|---|---|
| Subscription reminders | `RENEWAL_REMINDER_OFFSETS=` (empty) + restart |
| Domain notices | `DOMAIN_RENEWAL_NOTICE_OFFSETS=` (empty) + restart |
| Domain auto-invoicing | `DOMAIN_RENEWAL_INVOICE_LEAD=0` + restart |
| Registrar sync | `RESELLER_SYNC_MODE=off` + restart |
| An admin UI surface | toggle its module off in `/admin/features` |

## Rollback

Migrations are additive and idempotent — there is **no destructive
down-migration**. To revert behavior, use the kill switches above (or redeploy
the previous image); the new columns/tables can remain in place harmlessly.

## Post-deploy verification checklist

- [ ] payment-api scheduler logging steady, no repeated errors.
- [ ] No unexpected duplicate invoices (the weekly-cycle double-bill fix is in;
      spot-check any weekly subs).
- [ ] `/admin/renewals` upcoming lists + reminder log look right.
- [ ] A coupon applied to a subscription discounts the invoice and records one
      `coupon_redemptions` row per cycle with the cap counting once.
- [ ] Portal customer can view and cancel-at-period-end their subscription.
