-- Versioned market service areas. No boundary is seeded.
-- US Coronado enforcement stays disabled until an approved GeoJSON row is activated.
-- Airports are unchanged. PostGIS is not required.

CREATE TABLE IF NOT EXISTS "service_areas" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "market_code" varchar(8) NOT NULL,
  "code" varchar(64) NOT NULL,
  "name" varchar(100) NOT NULL,
  "version" integer NOT NULL,
  "status" varchar(20) DEFAULT 'draft' NOT NULL,
  "geometry" jsonb NOT NULL,
  "policy" varchar(40) DEFAULT 'pickup_and_dropoff' NOT NULL,
  "enforcement_enabled" boolean DEFAULT false NOT NULL,
  "source_label" varchar(255),
  "source_url" varchar(1000),
  "approved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "service_areas_status_check"
    CHECK ("status" in ('draft', 'active', 'retired')),
  CONSTRAINT "service_areas_policy_check"
    CHECK ("policy" = 'pickup_and_dropoff'),
  CONSTRAINT "service_areas_version_check"
    CHECK ("version" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_service_areas_market_code_version"
  ON "service_areas" ("market_code", "code", "version");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_service_areas_one_active_version"
  ON "service_areas" ("market_code", "code")
  WHERE "status" = 'active';

CREATE INDEX IF NOT EXISTS "idx_service_areas_market_status"
  ON "service_areas" ("market_code", "status");
