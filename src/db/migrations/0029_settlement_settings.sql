-- Admin-configurable settlement percentages.
-- Does not recalculate existing booking_settlements (none are expected).
-- Default active rule: airport 0 / driver 25 / company 75, version 1.

CREATE TABLE IF NOT EXISTS "settlement_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "airport_fee_percentage" numeric(6, 2) NOT NULL,
  "driver_percentage" numeric(6, 2) NOT NULL,
  "company_percentage" numeric(6, 2) NOT NULL,
  "version" integer NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'settlement_settings_airport_fee_percentage_check'
  ) THEN
    ALTER TABLE "settlement_settings"
      ADD CONSTRAINT "settlement_settings_airport_fee_percentage_check"
      CHECK ("airport_fee_percentage" >= 0 AND "airport_fee_percentage" <= 100);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'settlement_settings_driver_percentage_check'
  ) THEN
    ALTER TABLE "settlement_settings"
      ADD CONSTRAINT "settlement_settings_driver_percentage_check"
      CHECK ("driver_percentage" >= 0 AND "driver_percentage" <= 100);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'settlement_settings_company_percentage_check'
  ) THEN
    ALTER TABLE "settlement_settings"
      ADD CONSTRAINT "settlement_settings_company_percentage_check"
      CHECK ("company_percentage" >= 0 AND "company_percentage" <= 100);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'settlement_settings_percentage_total_check'
  ) THEN
    ALTER TABLE "settlement_settings"
      ADD CONSTRAINT "settlement_settings_percentage_total_check"
      CHECK ("airport_fee_percentage" + "driver_percentage" + "company_percentage" = 100);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_settlement_settings_version"
  ON "settlement_settings" ("version");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_settlement_settings_active"
  ON "settlement_settings" ("is_active")
  WHERE "is_active" = true;

INSERT INTO "settlement_settings" (
  "airport_fee_percentage",
  "driver_percentage",
  "company_percentage",
  "version",
  "is_active"
)
SELECT 0.00, 25.00, 75.00, 1, true
WHERE NOT EXISTS (
  SELECT 1 FROM "settlement_settings" WHERE "is_active" = true
);

ALTER TABLE "booking_settlements"
  ADD COLUMN IF NOT EXISTS "airport_fee_percentage" numeric(6, 2);

ALTER TABLE "booking_settlements"
  ADD COLUMN IF NOT EXISTS "driver_percentage" numeric(6, 2);

ALTER TABLE "booking_settlements"
  ADD COLUMN IF NOT EXISTS "company_percentage" numeric(6, 2);
