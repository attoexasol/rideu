-- Walk-up Stripe test Checkout is a separate settlement class.
-- Production fare rows stay non-billable. Live mode cannot be stored here.

ALTER TABLE "meter_payments" ADD COLUMN IF NOT EXISTS "settlement_mode" varchar(32) DEFAULT 'production_disabled' NOT NULL;
ALTER TABLE "meter_payments" ADD COLUMN IF NOT EXISTS "test_only" boolean DEFAULT false NOT NULL;
ALTER TABLE "meter_payments" ADD COLUMN IF NOT EXISTS "stripe_livemode" boolean DEFAULT false NOT NULL;
ALTER TABLE "meter_payments" ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone;
ALTER TABLE "meter_payments" ADD COLUMN IF NOT EXISTS "fare_classification" varchar(64);

ALTER TABLE "meter_payments" DROP CONSTRAINT IF EXISTS "meter_payments_status_check";
ALTER TABLE "meter_payments" ADD CONSTRAINT "meter_payments_status_check"
  CHECK ("status" in ('not_billable', 'pending', 'checkout_open', 'paid', 'failed', 'cancelled', 'refunded'));

ALTER TABLE "meter_payments" DROP CONSTRAINT IF EXISTS "meter_payments_settlement_check";
ALTER TABLE "meter_payments" ADD CONSTRAINT "meter_payments_settlement_check"
  CHECK (
    (
      "settlement_mode" = 'production_disabled'
      AND "test_only" = false
      AND "status" = 'not_billable'
    )
    OR
    (
      "settlement_mode" = 'stripe_test'
      AND "test_only" = true
      AND "status" in ('pending', 'checkout_open', 'paid', 'failed', 'cancelled', 'refunded')
    )
  );

ALTER TABLE "meter_payments" DROP CONSTRAINT IF EXISTS "meter_payments_livemode_check";
ALTER TABLE "meter_payments" ADD CONSTRAINT "meter_payments_livemode_check"
  CHECK ("stripe_livemode" = false);

ALTER TABLE "meter_payments" DROP CONSTRAINT IF EXISTS "meter_payments_fare_class_check";
ALTER TABLE "meter_payments" ADD CONSTRAINT "meter_payments_fare_class_check"
  CHECK (
    "fare_classification" is null
    OR "fare_classification" = 'test_only_unapproved_tariff'
  );

CREATE UNIQUE INDEX IF NOT EXISTS "uq_meter_payments_payment_intent"
  ON "meter_payments" ("stripe_payment_intent_id")
  WHERE "stripe_payment_intent_id" is not null;

ALTER TABLE "walk_up_trips" DROP CONSTRAINT IF EXISTS "walk_up_trips_payment_status_check";
ALTER TABLE "walk_up_trips" ADD CONSTRAINT "walk_up_trips_payment_status_check"
  CHECK ("payment_status" in ('none', 'not_billable', 'pending', 'checkout_open', 'paid', 'failed', 'cancelled', 'refunded'));
