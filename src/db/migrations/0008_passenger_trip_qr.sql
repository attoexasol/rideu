-- Passenger pickup verification QR fields on trips (idempotent)
ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "passenger_qr_code" varchar(255);--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "qr_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "qr_verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "trip_type" varchar(50);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_trips_passenger_qr_code" ON "trips" ("passenger_qr_code") WHERE "passenger_qr_code" IS NOT NULL;
