-- Multi-fleet foundation: organizations, fleets, duty, vehicle QR tokens (no partial uniques yet)

DO $$ BEGIN
  CREATE TYPE "organization_type" AS ENUM('platform', 'company', 'agency', 'owner');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "organizations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(255) NOT NULL,
  "type" "organization_type" DEFAULT 'platform' NOT NULL,
  "status" varchar(50) DEFAULT 'active' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "fleets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "name" varchar(255) NOT NULL,
  "status" varchar(50) DEFAULT 'active' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "fleets" ADD CONSTRAINT "fleets_organization_id_organizations_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_fleets_organization_id" ON "fleets" ("organization_id");
--> statement-breakpoint

ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "fleet_id" uuid;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_fleet_id_fleets_id_fk"
    FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_vehicles_fleet_id" ON "vehicles" ("fleet_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "driver_fleet_memberships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "driver_id" uuid NOT NULL,
  "fleet_id" uuid NOT NULL,
  "status" varchar(50) DEFAULT 'active' NOT NULL,
  "joined_at" timestamp DEFAULT now() NOT NULL,
  "left_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "driver_fleet_memberships" ADD CONSTRAINT "driver_fleet_memberships_driver_id_drivers_id_fk"
    FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "driver_fleet_memberships" ADD CONSTRAINT "driver_fleet_memberships_fleet_id_fleets_id_fk"
    FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_driver_fleet_memberships_driver_id" ON "driver_fleet_memberships" ("driver_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_driver_fleet_memberships_fleet_id" ON "driver_fleet_memberships" ("fleet_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_driver_fleet_memberships_active_unique" ON "driver_fleet_memberships" ("driver_id", "fleet_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "duty_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "driver_id" uuid NOT NULL,
  "fleet_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "status" varchar(50) DEFAULT 'active' NOT NULL,
  "started_at" timestamp DEFAULT now() NOT NULL,
  "ended_at" timestamp,
  "start_vehicle_id" uuid,
  "ended_reason" varchar(100),
  "start_location" text,
  "end_location" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "duty_sessions" ADD CONSTRAINT "duty_sessions_driver_id_drivers_id_fk"
    FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "duty_sessions" ADD CONSTRAINT "duty_sessions_fleet_id_fleets_id_fk"
    FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "duty_sessions" ADD CONSTRAINT "duty_sessions_organization_id_organizations_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "duty_sessions" ADD CONSTRAINT "duty_sessions_start_vehicle_id_vehicles_id_fk"
    FOREIGN KEY ("start_vehicle_id") REFERENCES "vehicles"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_duty_sessions_driver_id" ON "duty_sessions" ("driver_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_duty_sessions_fleet_id" ON "duty_sessions" ("fleet_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_duty_sessions_status" ON "duty_sessions" ("status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "vehicle_qr_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "vehicle_id" uuid NOT NULL,
  "fleet_id" uuid NOT NULL,
  "token" varchar(255) NOT NULL,
  "status" varchar(50) DEFAULT 'active' NOT NULL,
  "legacy_source" varchar(100),
  "issued_at" timestamp DEFAULT now() NOT NULL,
  "revoked_at" timestamp,
  "issued_by_admin_id" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "vehicle_qr_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "vehicle_qr_tokens" ADD CONSTRAINT "vehicle_qr_tokens_vehicle_id_vehicles_id_fk"
    FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "vehicle_qr_tokens" ADD CONSTRAINT "vehicle_qr_tokens_fleet_id_fleets_id_fk"
    FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "vehicle_qr_tokens" ADD CONSTRAINT "vehicle_qr_tokens_issued_by_admin_id_admin_users_id_fk"
    FOREIGN KEY ("issued_by_admin_id") REFERENCES "admin_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_vehicle_qr_tokens_vehicle_id" ON "vehicle_qr_tokens" ("vehicle_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vehicle_qr_tokens_fleet_id" ON "vehicle_qr_tokens" ("fleet_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vehicle_qr_tokens_status" ON "vehicle_qr_tokens" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vehicle_qr_tokens_token" ON "vehicle_qr_tokens" ("token");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "vehicle_service_categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "vehicle_id" uuid NOT NULL,
  "service_category_id" uuid NOT NULL,
  "is_primary" boolean DEFAULT false NOT NULL,
  "verified_at" timestamp,
  "source" varchar(50) DEFAULT 'migration',
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "vehicle_service_categories" ADD CONSTRAINT "vehicle_service_categories_vehicle_id_vehicles_id_fk"
    FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "vehicle_service_categories" ADD CONSTRAINT "vehicle_service_categories_service_category_id_service_categories_id_fk"
    FOREIGN KEY ("service_category_id") REFERENCES "service_categories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_vehicle_service_categories_unique" ON "vehicle_service_categories" ("vehicle_id", "service_category_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vehicle_service_categories_vehicle_id" ON "vehicle_service_categories" ("vehicle_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vehicle_service_categories_category" ON "vehicle_service_categories" ("service_category_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "fleet_audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_type" varchar(100) NOT NULL,
  "actor_type" varchar(50) NOT NULL,
  "actor_id" uuid,
  "entity_type" varchar(50),
  "entity_id" uuid,
  "driver_id" uuid,
  "vehicle_id" uuid,
  "fleet_id" uuid,
  "payload" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_fleet_audit_events_event_type" ON "fleet_audit_events" ("event_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fleet_audit_events_driver_id" ON "fleet_audit_events" ("driver_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fleet_audit_events_fleet_id" ON "fleet_audit_events" ("fleet_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fleet_audit_events_created_at" ON "fleet_audit_events" ("created_at");
--> statement-breakpoint

ALTER TABLE "driver_vehicle_assignments" ADD COLUMN IF NOT EXISTS "fleet_id" uuid;
--> statement-breakpoint
ALTER TABLE "driver_vehicle_assignments" ADD COLUMN IF NOT EXISTS "duty_session_id" uuid;
--> statement-breakpoint
ALTER TABLE "driver_vehicle_assignments" ADD COLUMN IF NOT EXISTS "assigned_by" varchar(50);
--> statement-breakpoint
ALTER TABLE "driver_vehicle_assignments" ADD COLUMN IF NOT EXISTS "assignment_reason" varchar(100);
--> statement-breakpoint
ALTER TABLE "driver_vehicle_assignments" ADD COLUMN IF NOT EXISTS "unassigned_reason" varchar(100);
--> statement-breakpoint
ALTER TABLE "driver_vehicle_assignments" ADD COLUMN IF NOT EXISTS "predecessor_assignment_id" uuid;
--> statement-breakpoint
ALTER TABLE "driver_vehicle_assignments" ADD COLUMN IF NOT EXISTS "exchange_request_id" uuid;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "driver_vehicle_assignments" ADD CONSTRAINT "driver_vehicle_assignments_fleet_id_fleets_id_fk"
    FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "driver_vehicle_assignments" ADD CONSTRAINT "driver_vehicle_assignments_duty_session_id_duty_sessions_id_fk"
    FOREIGN KEY ("duty_session_id") REFERENCES "duty_sessions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_dva_fleet_id" ON "driver_vehicle_assignments" ("fleet_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dva_duty_session_id" ON "driver_vehicle_assignments" ("duty_session_id");
