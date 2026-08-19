-- Profile / account foundation: driver avatar + account lifecycle (separate from duty status).
ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "profile_image_url" varchar(500);
ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "account_status" varchar(30) NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS "idx_drivers_account_status" ON "drivers" ("account_status");
CREATE INDEX IF NOT EXISTS "idx_customers_status" ON "customers" ("status");
