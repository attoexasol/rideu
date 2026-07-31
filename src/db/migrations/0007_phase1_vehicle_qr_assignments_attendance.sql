-- Phase-1: vehicle QR fields + assignment + attendance tables
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "qr_code" varchar(255);--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "body_number" varchar(255);--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "status" varchar(50) DEFAULT 'active' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_vehicles_qr_code" ON "vehicles" ("qr_code") WHERE "qr_code" IS NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "driver_vehicle_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "driver_id" uuid NOT NULL REFERENCES "drivers"("id") ON DELETE CASCADE,
  "vehicle_id" uuid NOT NULL REFERENCES "vehicles"("id") ON DELETE CASCADE,
  "assigned_at" timestamp DEFAULT now() NOT NULL,
  "unassigned_at" timestamp,
  "is_active" boolean DEFAULT true NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dva_driver_id" ON "driver_vehicle_assignments" ("driver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dva_vehicle_id" ON "driver_vehicle_assignments" ("vehicle_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dva_is_active" ON "driver_vehicle_assignments" ("is_active");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "driver_attendance" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "driver_id" uuid NOT NULL REFERENCES "drivers"("id") ON DELETE CASCADE,
  "check_in_time" timestamp DEFAULT now() NOT NULL,
  "check_out_time" timestamp,
  "location" text,
  "status" varchar(50) NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_da_driver_id" ON "driver_attendance" ("driver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_da_status" ON "driver_attendance" ("status");
