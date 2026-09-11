-- Reverse 0029. Does not delete booking_settlements rows.

ALTER TABLE "booking_settlements" DROP COLUMN IF EXISTS "company_percentage";
ALTER TABLE "booking_settlements" DROP COLUMN IF EXISTS "driver_percentage";
ALTER TABLE "booking_settlements" DROP COLUMN IF EXISTS "airport_fee_percentage";

DROP TABLE IF EXISTS "settlement_settings";
