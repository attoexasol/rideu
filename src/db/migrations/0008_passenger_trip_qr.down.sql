-- Rollback for 0008_passenger_trip_qr
DROP INDEX IF EXISTS "idx_trips_passenger_qr_code";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN IF EXISTS "trip_type";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN IF EXISTS "qr_verified_at";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN IF EXISTS "qr_verified";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN IF EXISTS "passenger_qr_code";
