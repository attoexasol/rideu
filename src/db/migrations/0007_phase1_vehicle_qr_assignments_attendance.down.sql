-- Rollback for 0007_phase1_vehicle_qr_assignments_attendance
DROP TABLE IF EXISTS "driver_attendance";--> statement-breakpoint
DROP TABLE IF EXISTS "driver_vehicle_assignments";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_vehicles_qr_code";--> statement-breakpoint
ALTER TABLE "vehicles" DROP COLUMN IF EXISTS "status";--> statement-breakpoint
ALTER TABLE "vehicles" DROP COLUMN IF EXISTS "body_number";--> statement-breakpoint
ALTER TABLE "vehicles" DROP COLUMN IF EXISTS "qr_code";
