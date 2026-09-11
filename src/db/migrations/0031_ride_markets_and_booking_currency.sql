-- Market-aware transaction currency (BD=BDT, US=USD).
-- Does not recalculate historical fares, payments, or settlements.
-- Copies existing global category rates into the Bangladesh market only.
-- Does not invent U.S. fare amounts.

CREATE TABLE IF NOT EXISTS "ride_markets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(8) NOT NULL,
  "name" varchar(100) NOT NULL,
  "country_code" varchar(2) NOT NULL,
  "currency" varchar(10) NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_ride_markets_code"
  ON "ride_markets" ("code");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_ride_markets_country_code"
  ON "ride_markets" ("country_code");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ride_markets_currency_check'
  ) THEN
    ALTER TABLE "ride_markets"
      ADD CONSTRAINT "ride_markets_currency_check"
      CHECK ("currency" IN ('BDT', 'USD'));
  END IF;
END $$;

INSERT INTO "ride_markets" ("code", "name", "country_code", "currency", "is_active")
SELECT 'BD', 'Bangladesh', 'BD', 'BDT', true
WHERE NOT EXISTS (SELECT 1 FROM "ride_markets" WHERE "code" = 'BD');

INSERT INTO "ride_markets" ("code", "name", "country_code", "currency", "is_active")
SELECT 'US', 'United States', 'US', 'USD', true
WHERE NOT EXISTS (SELECT 1 FROM "ride_markets" WHERE "code" = 'US');

CREATE TABLE IF NOT EXISTS "service_category_market_fares" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "market_id" uuid NOT NULL REFERENCES "ride_markets"("id") ON DELETE CASCADE,
  "service_category_id" uuid NOT NULL REFERENCES "service_categories"("id") ON DELETE CASCADE,
  "base_fare" numeric(10, 2) NOT NULL,
  "per_km_rate" numeric(10, 2) NOT NULL,
  "min_fare" numeric(10, 2) NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_market_fares_market_category"
  ON "service_category_market_fares" ("market_id", "service_category_id");

CREATE INDEX IF NOT EXISTS "idx_market_fares_market_id"
  ON "service_category_market_fares" ("market_id");

-- Existing global rates are Bangladesh pricing only. Do not copy them to US.
INSERT INTO "service_category_market_fares" (
  "market_id",
  "service_category_id",
  "base_fare",
  "per_km_rate",
  "min_fare"
)
SELECT
  m.id,
  c.id,
  c.base_fare,
  c.per_km_rate,
  c.min_fare
FROM "ride_markets" m
JOIN "service_categories" c ON true
WHERE m.code = 'BD'
  AND NOT EXISTS (
    SELECT 1
    FROM "service_category_market_fares" f
    WHERE f.market_id = m.id AND f.service_category_id = c.id
  );

ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "currency" varchar(10);

UPDATE "bookings"
SET "currency" = 'BDT'
WHERE "currency" IS NULL;

ALTER TABLE "bookings"
  ALTER COLUMN "currency" SET DEFAULT 'BDT';

ALTER TABLE "bookings"
  ALTER COLUMN "currency" SET NOT NULL;

ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "market_code" varchar(8);

ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "pickup_country_code" varchar(2);

UPDATE "bookings"
SET "market_code" = 'BD'
WHERE "market_code" IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_currency_check'
  ) THEN
    ALTER TABLE "bookings"
      ADD CONSTRAINT "bookings_currency_check"
      CHECK ("currency" IN ('BDT', 'USD'));
  END IF;
END $$;
