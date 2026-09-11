ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_currency_check";
ALTER TABLE "bookings" DROP COLUMN IF EXISTS "pickup_country_code";
ALTER TABLE "bookings" DROP COLUMN IF EXISTS "market_code";
ALTER TABLE "bookings" DROP COLUMN IF EXISTS "currency";

DROP TABLE IF EXISTS "service_category_market_fares";
DROP TABLE IF EXISTS "ride_markets";
