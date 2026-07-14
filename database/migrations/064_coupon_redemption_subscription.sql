-- 064_coupon_redemption_subscription.sql
-- Links a coupon redemption to the subscription it applied to, so that
-- max_redemptions counts DISTINCT subscriptions (one-time uses) rather than
-- every recurring invoice. Without this, a capped coupon attached to a
-- monthly subscription would exhaust itself after N invoices and silently
-- drop the promised recurring discount.
--
-- The scheduler records a redemption row for every application (audit) but
-- only increments coupons.redemption_count the first time a given
-- subscription redeems the coupon (see coupons.go / scheduler.go).
--
-- Next migration: 065_*.sql

BEGIN;

ALTER TABLE coupon_redemptions
    ADD COLUMN IF NOT EXISTS subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_sub
    ON coupon_redemptions (coupon_id, subscription_id);

COMMIT;
