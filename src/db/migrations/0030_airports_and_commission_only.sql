-- Multi-airport fixed fees + commission-only settlement settings.
-- Does not recalculate existing booking_payments or booking_settlements.
-- Does not seed SAN coordinates/fees (unknown / not in repo).

-- 1. Commission settings: driver + company = 100. Airport % is unused.

ALTER TABLE "settlement_settings"
  DROP CONSTRAINT IF EXISTS "settlement_settings_percentage_total_check";

ALTER TABLE "settlement_settings"
  DROP CONSTRAINT IF EXISTS "settlement_settings_airport_fee_percentage_check";

ALTER TABLE "settlement_settings"
  DROP COLUMN IF EXISTS "airport_fee_percentage";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'settlement_settings_commission_total_check'
  ) THEN
    ALTER TABLE "settlement_settings"
      ADD CONSTRAINT "settlement_settings_commission_total_check"
      CHECK ("driver_percentage" + "company_percentage" = 100);
  END IF;
END $$;

-- 2. Generic airport configuration (radius geofence v1).

CREATE TABLE IF NOT EXISTS "airports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(16) NOT NULL,
  "name" varchar(255) NOT NULL,
  "google_place_id" varchar(255),
  "country_code" varchar(2) NOT NULL,
  "currency" varchar(10) NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "geofence_type" varchar(20) NOT NULL DEFAULT 'radius',
  "center_latitude" numeric(10, 8) NOT NULL,
  "center_longitude" numeric(11, 8) NOT NULL,
  "radius_meters" integer NOT NULL,
  "geofence_polygon" jsonb,
  "pickup_fee_minor" bigint NOT NULL,
  "dropoff_fee_minor" bigint NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_airports_code"
  ON "airports" ("code");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_airports_google_place_id"
  ON "airports" ("google_place_id")
  WHERE "google_place_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_airports_active"
  ON "airports" ("is_active");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'airports_geofence_type_check'
  ) THEN
    ALTER TABLE "airports"
      ADD CONSTRAINT "airports_geofence_type_check"
      CHECK ("geofence_type" IN ('radius', 'polygon'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'airports_radius_meters_check'
  ) THEN
    ALTER TABLE "airports"
      ADD CONSTRAINT "airports_radius_meters_check"
      CHECK ("radius_meters" > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'airports_pickup_fee_minor_check'
  ) THEN
    ALTER TABLE "airports"
      ADD CONSTRAINT "airports_pickup_fee_minor_check"
      CHECK ("pickup_fee_minor" >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'airports_dropoff_fee_minor_check'
  ) THEN
    ALTER TABLE "airports"
      ADD CONSTRAINT "airports_dropoff_fee_minor_check"
      CHECK ("dropoff_fee_minor" >= 0);
  END IF;
END $$;

-- 3. Booking airport snapshot. final_fare remains passenger total.

ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "pickup_place_id" varchar(255);

ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "airport_id" uuid;

ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "airport_code_snapshot" varchar(16);

ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "airport_name_snapshot" varchar(255);

ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "airport_trip_type" varchar(20);

ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "airport_fee_amount" numeric(10, 2) NOT NULL DEFAULT 0;

ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "regular_trip_fare" numeric(10, 2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_airport_id_airports_id_fk'
  ) THEN
    ALTER TABLE "bookings"
      ADD CONSTRAINT "bookings_airport_id_airports_id_fk"
      FOREIGN KEY ("airport_id") REFERENCES "airports"("id") ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_airport_trip_type_check'
  ) THEN
    ALTER TABLE "bookings"
      ADD CONSTRAINT "bookings_airport_trip_type_check"
      CHECK ("airport_trip_type" IS NULL OR "airport_trip_type" IN ('pickup', 'dropoff'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_bookings_airport_id"
  ON "bookings" ("airport_id");
