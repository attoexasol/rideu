-- Phase 3: two-driver vehicle exchange

CREATE TABLE IF NOT EXISTS "vehicle_exchange_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "fleet_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "initiator_driver_id" uuid NOT NULL,
  "partner_driver_id" uuid NOT NULL,
  "initiator_vehicle_id" uuid NOT NULL,
  "partner_vehicle_id" uuid NOT NULL,
  "initiator_assignment_id" uuid NOT NULL,
  "partner_assignment_id" uuid NOT NULL,
  "initiator_duty_session_id" uuid NOT NULL,
  "partner_duty_session_id" uuid NOT NULL,
  "initiator_scanned_token_id" uuid,
  "partner_scanned_token_id" uuid,
  "status" varchar(50) DEFAULT 'pending' NOT NULL,
  "idempotency_key" varchar(255) NOT NULL,
  "expires_at" timestamp NOT NULL,
  "initiated_at" timestamp DEFAULT now() NOT NULL,
  "confirmed_at" timestamp,
  "cancelled_at" timestamp,
  "cancelled_by_driver_id" uuid,
  "cancel_reason" varchar(255),
  "completed_by" varchar(50),
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "vehicle_exchange_requests" ADD CONSTRAINT "vehicle_exchange_requests_fleet_id_fleets_id_fk"
    FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "vehicle_exchange_requests" ADD CONSTRAINT "vehicle_exchange_requests_organization_id_organizations_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "vehicle_exchange_requests" ADD CONSTRAINT "vehicle_exchange_requests_initiator_driver_id_drivers_id_fk"
    FOREIGN KEY ("initiator_driver_id") REFERENCES "drivers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "vehicle_exchange_requests" ADD CONSTRAINT "vehicle_exchange_requests_partner_driver_id_drivers_id_fk"
    FOREIGN KEY ("partner_driver_id") REFERENCES "drivers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "vehicle_exchange_requests" ADD CONSTRAINT "vehicle_exchange_requests_initiator_vehicle_id_vehicles_id_fk"
    FOREIGN KEY ("initiator_vehicle_id") REFERENCES "vehicles"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "vehicle_exchange_requests" ADD CONSTRAINT "vehicle_exchange_requests_partner_vehicle_id_vehicles_id_fk"
    FOREIGN KEY ("partner_vehicle_id") REFERENCES "vehicles"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "vehicle_exchange_requests" ADD CONSTRAINT "vehicle_exchange_requests_initiator_assignment_id_dva_id_fk"
    FOREIGN KEY ("initiator_assignment_id") REFERENCES "driver_vehicle_assignments"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "vehicle_exchange_requests" ADD CONSTRAINT "vehicle_exchange_requests_partner_assignment_id_dva_id_fk"
    FOREIGN KEY ("partner_assignment_id") REFERENCES "driver_vehicle_assignments"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "vehicle_exchange_requests" ADD CONSTRAINT "vehicle_exchange_requests_initiator_duty_session_id_fk"
    FOREIGN KEY ("initiator_duty_session_id") REFERENCES "duty_sessions"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "vehicle_exchange_requests" ADD CONSTRAINT "vehicle_exchange_requests_partner_duty_session_id_fk"
    FOREIGN KEY ("partner_duty_session_id") REFERENCES "duty_sessions"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "vehicle_exchange_requests" ADD CONSTRAINT "vehicle_exchange_requests_initiator_scanned_token_id_fk"
    FOREIGN KEY ("initiator_scanned_token_id") REFERENCES "vehicle_qr_tokens"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "vehicle_exchange_requests" ADD CONSTRAINT "vehicle_exchange_requests_partner_scanned_token_id_fk"
    FOREIGN KEY ("partner_scanned_token_id") REFERENCES "vehicle_qr_tokens"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "vehicle_exchange_requests" ADD CONSTRAINT "vehicle_exchange_requests_cancelled_by_driver_id_fk"
    FOREIGN KEY ("cancelled_by_driver_id") REFERENCES "drivers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_ver_status" ON "vehicle_exchange_requests" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ver_expires_at" ON "vehicle_exchange_requests" ("expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ver_initiator_driver" ON "vehicle_exchange_requests" ("initiator_driver_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ver_partner_driver" ON "vehicle_exchange_requests" ("partner_driver_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_ver_initiator_idempotency" ON "vehicle_exchange_requests" ("initiator_driver_id", "idempotency_key");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "vehicle_exchange_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "exchange_request_id" uuid NOT NULL,
  "event_type" varchar(100) NOT NULL,
  "actor_type" varchar(50) NOT NULL,
  "actor_id" uuid,
  "payload" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "vehicle_exchange_events" ADD CONSTRAINT "vehicle_exchange_events_exchange_request_id_fk"
    FOREIGN KEY ("exchange_request_id") REFERENCES "vehicle_exchange_requests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_vee_exchange_request_id" ON "vehicle_exchange_events" ("exchange_request_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vee_event_type" ON "vehicle_exchange_events" ("event_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vee_created_at" ON "vehicle_exchange_events" ("created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "vehicle_exchange_resource_locks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "exchange_request_id" uuid NOT NULL,
  "resource_type" varchar(20) NOT NULL,
  "resource_id" uuid NOT NULL,
  "released_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "vehicle_exchange_resource_locks" ADD CONSTRAINT "vehicle_exchange_resource_locks_exchange_request_id_fk"
    FOREIGN KEY ("exchange_request_id") REFERENCES "vehicle_exchange_requests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_verl_exchange_request_id" ON "vehicle_exchange_resource_locks" ("exchange_request_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_verl_resource" ON "vehicle_exchange_resource_locks" ("resource_type", "resource_id");
--> statement-breakpoint

-- One active lock per driver (any role in any pending exchange)
CREATE UNIQUE INDEX IF NOT EXISTS "uq_verl_active_driver"
  ON "vehicle_exchange_resource_locks" ("resource_id")
  WHERE "resource_type" = 'driver' AND "released_at" IS NULL;
--> statement-breakpoint

-- One active lock per vehicle (any role in any pending exchange)
CREATE UNIQUE INDEX IF NOT EXISTS "uq_verl_active_vehicle"
  ON "vehicle_exchange_resource_locks" ("resource_id")
  WHERE "resource_type" = 'vehicle' AND "released_at" IS NULL;
