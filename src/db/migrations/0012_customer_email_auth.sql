-- Passenger auth: email instead of phone
ALTER TABLE "customers" ALTER COLUMN "phone_country_code" DROP NOT NULL;
ALTER TABLE "customers" ALTER COLUMN "phone_number" DROP NOT NULL;

UPDATE "customers"
SET "email" = CONCAT('legacy-', "id", '@customers.migrated.local')
WHERE "email" IS NULL;

ALTER TABLE "customers" ALTER COLUMN "email" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_customers_email_unique" ON "customers" ("email");

DROP INDEX IF EXISTS "idx_customers_phone_unique";

ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "email_verified_at" timestamp;
