-- Passenger maps and booking route enhancements
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "route_encoded_polyline" varchar(8192);
ALTER TABLE "customer_places" ADD COLUMN IF NOT EXISTS "country_code" varchar(10);
CREATE INDEX IF NOT EXISTS "idx_customer_places_customer_type" ON "customer_places" ("customer_id", "place_type");

CREATE TABLE IF NOT EXISTS "booking_idempotency_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "idempotency_key" varchar(128) NOT NULL,
  "booking_id" uuid REFERENCES "bookings"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_booking_idempotency_customer_key"
  ON "booking_idempotency_keys" ("customer_id", "idempotency_key");
