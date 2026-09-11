-- Rollback for 0028_driver_stripe_connect
-- Drops local Connect columns only. Does not delete Stripe connected accounts.

DROP INDEX IF EXISTS "idx_drivers_stripe_account_status";
DROP INDEX IF EXISTS "uq_drivers_stripe_account_id";

ALTER TABLE "drivers" DROP COLUMN IF EXISTS "stripe_last_synced_at";
ALTER TABLE "drivers" DROP COLUMN IF EXISTS "stripe_onboarding_completed_at";
ALTER TABLE "drivers" DROP COLUMN IF EXISTS "stripe_requirements_eventually_due";
ALTER TABLE "drivers" DROP COLUMN IF EXISTS "stripe_requirements_currently_due";
ALTER TABLE "drivers" DROP COLUMN IF EXISTS "stripe_payouts_enabled";
ALTER TABLE "drivers" DROP COLUMN IF EXISTS "stripe_charges_enabled";
ALTER TABLE "drivers" DROP COLUMN IF EXISTS "stripe_details_submitted";
ALTER TABLE "drivers" DROP COLUMN IF EXISTS "stripe_account_status";
ALTER TABLE "drivers" DROP COLUMN IF EXISTS "stripe_account_country";
ALTER TABLE "drivers" DROP COLUMN IF EXISTS "stripe_account_id";
