-- Stripe Phase A: payment ledger, settlement placeholder, webhook idempotency.
-- Does not alter bookings.final_fare, bookings.status, or bookings.payment_status.
-- Existing cash bookings do not require these rows.

INSERT INTO "payment_methods" ("code", "name", "is_active")
VALUES ('card', 'Card', false)
ON CONFLICT ("code") DO NOTHING;

CREATE TABLE IF NOT EXISTS "booking_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "booking_id" uuid NOT NULL,
  "payment_method" varchar(20) NOT NULL,
  "currency" varchar(10) NOT NULL,
  "gross_amount" bigint NOT NULL,
  "provider" varchar(30) NOT NULL,
  "provider_payment_intent_id" varchar(255),
  "provider_charge_id" varchar(255),
  "status" varchar(50) NOT NULL,
  "authorized_at" timestamptz,
  "captured_at" timestamptz,
  "failed_at" timestamptz,
  "refunded_at" timestamptz,
  "failure_code" varchar(100),
  "failure_message" varchar(500),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'booking_payments_booking_id_bookings_id_fk'
  ) THEN
    ALTER TABLE "booking_payments"
      ADD CONSTRAINT "booking_payments_booking_id_bookings_id_fk"
      FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'booking_payments_payment_method_check'
  ) THEN
    ALTER TABLE "booking_payments"
      ADD CONSTRAINT "booking_payments_payment_method_check"
      CHECK ("payment_method" IN ('cash', 'card'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'booking_payments_provider_check'
  ) THEN
    ALTER TABLE "booking_payments"
      ADD CONSTRAINT "booking_payments_provider_check"
      CHECK ("provider" IN ('none', 'cash', 'stripe'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'booking_payments_status_check'
  ) THEN
    ALTER TABLE "booking_payments"
      ADD CONSTRAINT "booking_payments_status_check"
      CHECK ("status" IN (
        'pending',
        'requires_payment_method',
        'requires_action',
        'authorized',
        'capture_pending',
        'captured',
        'failed',
        'cancelled',
        'refund_pending',
        'refunded'
      ));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'booking_payments_gross_amount_check'
  ) THEN
    ALTER TABLE "booking_payments"
      ADD CONSTRAINT "booking_payments_gross_amount_check"
      CHECK ("gross_amount" >= 0);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_booking_payments_booking_id"
  ON "booking_payments" ("booking_id");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_booking_payments_provider_payment_intent_id"
  ON "booking_payments" ("provider_payment_intent_id");

CREATE INDEX IF NOT EXISTS "idx_booking_payments_status"
  ON "booking_payments" ("status");

CREATE INDEX IF NOT EXISTS "idx_booking_payments_payment_method"
  ON "booking_payments" ("payment_method");

CREATE TABLE IF NOT EXISTS "booking_settlements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "booking_id" uuid NOT NULL,
  "payment_id" uuid,
  "status" varchar(50) NOT NULL,
  "gross_amount" bigint NOT NULL,
  "driver_amount" bigint,
  "platform_amount" bigint,
  "airport_fee" bigint,
  "currency" varchar(10) NOT NULL,
  "provider_transfer_id" varchar(255),
  "calculation_version" varchar(50),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'booking_settlements_booking_id_bookings_id_fk'
  ) THEN
    ALTER TABLE "booking_settlements"
      ADD CONSTRAINT "booking_settlements_booking_id_bookings_id_fk"
      FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'booking_settlements_payment_id_booking_payments_id_fk'
  ) THEN
    ALTER TABLE "booking_settlements"
      ADD CONSTRAINT "booking_settlements_payment_id_booking_payments_id_fk"
      FOREIGN KEY ("payment_id") REFERENCES "booking_payments"("id") ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'booking_settlements_status_check'
  ) THEN
    ALTER TABLE "booking_settlements"
      ADD CONSTRAINT "booking_settlements_status_check"
      CHECK ("status" IN ('unresolved', 'pending', 'processing', 'settled', 'failed', 'skipped_cash'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'booking_settlements_gross_amount_check'
  ) THEN
    ALTER TABLE "booking_settlements"
      ADD CONSTRAINT "booking_settlements_gross_amount_check"
      CHECK ("gross_amount" >= 0);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_booking_settlements_booking_id"
  ON "booking_settlements" ("booking_id");

CREATE INDEX IF NOT EXISTS "idx_booking_settlements_payment_id"
  ON "booking_settlements" ("payment_id");

CREATE INDEX IF NOT EXISTS "idx_booking_settlements_status"
  ON "booking_settlements" ("status");

CREATE TABLE IF NOT EXISTS "stripe_webhook_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "stripe_event_id" varchar(255) NOT NULL,
  "event_type" varchar(100) NOT NULL,
  "processing_status" varchar(30) NOT NULL,
  "received_at" timestamptz DEFAULT now() NOT NULL,
  "processed_at" timestamptz,
  "last_error" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stripe_webhook_events_processing_status_check'
  ) THEN
    ALTER TABLE "stripe_webhook_events"
      ADD CONSTRAINT "stripe_webhook_events_processing_status_check"
      CHECK ("processing_status" IN ('received', 'processed', 'failed'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_stripe_webhook_events_stripe_event_id"
  ON "stripe_webhook_events" ("stripe_event_id");

CREATE INDEX IF NOT EXISTS "idx_stripe_webhook_events_processing_status"
  ON "stripe_webhook_events" ("processing_status");

CREATE INDEX IF NOT EXISTS "idx_stripe_webhook_events_event_type"
  ON "stripe_webhook_events" ("event_type");
