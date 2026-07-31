-- Driver-scoped vehicle QR (cab info lives on drivers table)
ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "vehicle_qr_code" varchar(255);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_drivers_vehicle_qr_code" ON "drivers" ("vehicle_qr_code") WHERE "vehicle_qr_code" IS NOT NULL;
