-- Partial unique constraints for active duty and assignments.
-- Run db:multi-fleet-backfill before this migration.

CREATE UNIQUE INDEX IF NOT EXISTS "uq_dva_one_active_per_driver"
  ON "driver_vehicle_assignments" ("driver_id")
  WHERE "is_active" = true;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_dva_one_active_per_vehicle"
  ON "driver_vehicle_assignments" ("vehicle_id")
  WHERE "is_active" = true;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_duty_sessions_one_active_per_driver"
  ON "duty_sessions" ("driver_id")
  WHERE "status" = 'active';
