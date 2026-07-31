ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "qr_code" varchar(255);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_drivers_qr_code" ON "drivers" ("qr_code") WHERE "qr_code" IS NOT NULL;
