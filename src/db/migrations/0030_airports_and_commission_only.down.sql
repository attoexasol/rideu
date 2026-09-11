ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_airport_trip_type_check";
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_airport_id_airports_id_fk";
DROP INDEX IF EXISTS "idx_bookings_airport_id";

ALTER TABLE "bookings" DROP COLUMN IF EXISTS "regular_trip_fare";
ALTER TABLE "bookings" DROP COLUMN IF EXISTS "airport_fee_amount";
ALTER TABLE "bookings" DROP COLUMN IF EXISTS "airport_trip_type";
ALTER TABLE "bookings" DROP COLUMN IF EXISTS "airport_name_snapshot";
ALTER TABLE "bookings" DROP COLUMN IF EXISTS "airport_code_snapshot";
ALTER TABLE "bookings" DROP COLUMN IF EXISTS "airport_id";
ALTER TABLE "bookings" DROP COLUMN IF EXISTS "pickup_place_id";

DROP TABLE IF EXISTS "airports";

ALTER TABLE "settlement_settings"
  DROP CONSTRAINT IF EXISTS "settlement_settings_commission_total_check";

ALTER TABLE "settlement_settings"
  ADD COLUMN IF NOT EXISTS "airport_fee_percentage" numeric(6, 2) NOT NULL DEFAULT 0;

UPDATE "settlement_settings" SET "airport_fee_percentage" = 0 WHERE "airport_fee_percentage" IS NULL;

ALTER TABLE "settlement_settings"
  ADD CONSTRAINT "settlement_settings_percentage_total_check"
  CHECK ("airport_fee_percentage" + "driver_percentage" + "company_percentage" = 100);
