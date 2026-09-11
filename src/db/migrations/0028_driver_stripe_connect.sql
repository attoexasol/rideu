-- Stripe Phase B: driver connected-account payout readiness.
-- Nullable Connect fields only. Does not alter bookings, fare, or cash.
-- Does not backfill fake Stripe accounts.

ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "stripe_account_id" varchar(255);
ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "stripe_account_country" varchar(2);
ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "stripe_account_status" varchar(50);
ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "stripe_details_submitted" boolean NOT NULL DEFAULT false;
ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "stripe_charges_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "stripe_payouts_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "stripe_requirements_currently_due" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "stripe_requirements_eventually_due" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "stripe_onboarding_completed_at" timestamp;
ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "stripe_last_synced_at" timestamp;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_drivers_stripe_account_id"
  ON "drivers" ("stripe_account_id");

CREATE INDEX IF NOT EXISTS "idx_drivers_stripe_account_status"
  ON "drivers" ("stripe_account_status");
