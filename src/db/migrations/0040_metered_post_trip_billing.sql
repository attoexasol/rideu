-- New bookings can be classified metered_post_trip.
-- Existing rows stay null and keep their original quote settlement.

ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "billing_mode" varchar(40);

ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_billing_mode_check";
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_billing_mode_check"
  CHECK ("billing_mode" is null OR "billing_mode" in ('metered_post_trip', 'quoted_prepay'));
