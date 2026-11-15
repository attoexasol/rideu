-- Soft meter foundation. Live charging stays disabled:
-- charging_enabled and billable are constrained false until a later migration.

CREATE TABLE IF NOT EXISTS "meter_rate_schedules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(64) NOT NULL,
  "name" varchar(120) NOT NULL,
  "version" integer NOT NULL,
  "status" varchar(32) DEFAULT 'draft' NOT NULL,
  "currency" varchar(3) NOT NULL,
  "flag_drop_cents" integer NOT NULL,
  "distance_rate_cents_per_mile" integer NOT NULL,
  "distance_increment_micro_miles" integer NOT NULL,
  "distance_increment_cents" integer NOT NULL,
  "waiting_cents_per_hour" integer NOT NULL,
  "waiting_cents_per_minute" integer NOT NULL,
  "charging_enabled" boolean DEFAULT false NOT NULL,
  "rules" jsonb NOT NULL,
  "created_by" varchar(255),
  "submitted_by" varchar(255),
  "approved_by" varchar(255),
  "activated_by" varchar(255),
  "retired_by" varchar(255),
  "submitted_at" timestamp with time zone,
  "approved_at" timestamp with time zone,
  "activated_at" timestamp with time zone,
  "retired_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "meter_rate_schedules_status_check"
    CHECK ("status" in ('draft', 'pending_approval', 'approved', 'active', 'retired')),
  CONSTRAINT "meter_rate_schedules_charging_disabled_check"
    CHECK ("charging_enabled" = false),
  CONSTRAINT "meter_rate_schedules_version_check"
    CHECK ("version" > 0),
  CONSTRAINT "meter_rate_schedules_money_check"
    CHECK (
      "flag_drop_cents" >= 0
      AND "distance_rate_cents_per_mile" >= 0
      AND "distance_increment_cents" >= 0
      AND "waiting_cents_per_hour" >= 0
      AND "waiting_cents_per_minute" >= 0
      AND "distance_increment_micro_miles" > 0
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_meter_rate_schedules_code_version"
  ON "meter_rate_schedules" ("code", "version");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_meter_rate_schedules_one_active"
  ON "meter_rate_schedules" ("code")
  WHERE "status" = 'active';

CREATE INDEX IF NOT EXISTS "idx_meter_rate_schedules_status"
  ON "meter_rate_schedules" ("status");

CREATE TABLE IF NOT EXISTS "meter_rate_schedule_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "schedule_id" uuid NOT NULL REFERENCES "meter_rate_schedules"("id") ON DELETE RESTRICT,
  "action" varchar(64) NOT NULL,
  "actor_id" varchar(255),
  "actor_role" varchar(64),
  "payload" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_meter_rate_schedule_events_schedule"
  ON "meter_rate_schedule_events" ("schedule_id", "created_at");

CREATE TABLE IF NOT EXISTS "walk_up_trips" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "driver_id" uuid NOT NULL REFERENCES "drivers"("id") ON DELETE RESTRICT,
  "vehicle_id" uuid NOT NULL REFERENCES "vehicles"("id") ON DELETE RESTRICT,
  "duty_session_id" uuid REFERENCES "duty_sessions"("id") ON DELETE SET NULL,
  "status" varchar(32) DEFAULT 'created' NOT NULL,
  "market_code" varchar(8),
  "currency" varchar(3) NOT NULL,
  "pickup_latitude" numeric(10, 8) NOT NULL,
  "pickup_longitude" numeric(11, 8) NOT NULL,
  "passenger_label" varchar(80),
  "idempotency_key" varchar(80),
  "payment_status" varchar(32) DEFAULT 'none' NOT NULL,
  "started_at" timestamp with time zone,
  "ended_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "walk_up_trips_status_check"
    CHECK ("status" in ('created', 'in_progress', 'ended', 'finalized', 'cancelled')),
  CONSTRAINT "walk_up_trips_payment_status_check"
    CHECK ("payment_status" in ('none', 'not_billable', 'pending', 'checkout_open', 'paid', 'failed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS "idx_walk_up_trips_driver_status"
  ON "walk_up_trips" ("driver_id", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_walk_up_trips_idempotency_key"
  ON "walk_up_trips" ("idempotency_key");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_walk_up_trips_one_open_driver"
  ON "walk_up_trips" ("driver_id")
  WHERE "status" in ('created', 'in_progress', 'ended');

CREATE TABLE IF NOT EXISTS "meter_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "trip_kind" varchar(20) NOT NULL,
  "booking_id" uuid REFERENCES "bookings"("id") ON DELETE RESTRICT,
  "walk_up_trip_id" uuid REFERENCES "walk_up_trips"("id") ON DELETE RESTRICT,
  "customer_id" uuid REFERENCES "customers"("id") ON DELETE SET NULL,
  "driver_id" uuid NOT NULL REFERENCES "drivers"("id") ON DELETE RESTRICT,
  "vehicle_id" uuid NOT NULL REFERENCES "vehicles"("id") ON DELETE RESTRICT,
  "rate_schedule_id" uuid NOT NULL REFERENCES "meter_rate_schedules"("id") ON DELETE RESTRICT,
  "rate_snapshot" jsonb NOT NULL,
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "started_at" timestamp with time zone,
  "stopped_at" timestamp with time zone,
  "finalized_at" timestamp with time zone,
  "start_idempotency_key" varchar(80),
  "stop_idempotency_key" varchar(80),
  "accepted_distance_millimeters" bigint DEFAULT 0 NOT NULL,
  "waiting_seconds" integer DEFAULT 0 NOT NULL,
  "rejected_point_count" integer DEFAULT 0 NOT NULL,
  "gap_count" integer DEFAULT 0 NOT NULL,
  "review_required" boolean DEFAULT false NOT NULL,
  "review_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "last_accepted_recorded_at" timestamp with time zone,
  "last_accepted_latitude" numeric(10, 8),
  "last_accepted_longitude" numeric(11, 8),
  "last_sequence" integer DEFAULT 0 NOT NULL,
  "provisional_total_cents" integer DEFAULT 0 NOT NULL,
  "billable" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "meter_sessions_kind_check"
    CHECK (
      ("trip_kind" = 'on_demand' AND "booking_id" IS NOT NULL AND "walk_up_trip_id" IS NULL)
      OR
      ("trip_kind" = 'walk_up' AND "walk_up_trip_id" IS NOT NULL AND "booking_id" IS NULL)
    ),
  CONSTRAINT "meter_sessions_status_check"
    CHECK ("status" in ('pending', 'running', 'stopped', 'finalized', 'voided')),
  CONSTRAINT "meter_sessions_billable_check"
    CHECK ("billable" = false),
  CONSTRAINT "meter_sessions_distance_check"
    CHECK ("accepted_distance_millimeters" >= 0 AND "waiting_seconds" >= 0)
);

CREATE INDEX IF NOT EXISTS "idx_meter_sessions_driver_status"
  ON "meter_sessions" ("driver_id", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_meter_sessions_booking"
  ON "meter_sessions" ("booking_id")
  WHERE "booking_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_meter_sessions_walk_up"
  ON "meter_sessions" ("walk_up_trip_id")
  WHERE "walk_up_trip_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_meter_sessions_one_open_driver"
  ON "meter_sessions" ("driver_id")
  WHERE "status" in ('pending', 'running', 'stopped');

CREATE TABLE IF NOT EXISTS "meter_gps_samples" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL REFERENCES "meter_sessions"("id") ON DELETE RESTRICT,
  "client_point_id" varchar(120) NOT NULL,
  "sequence" integer NOT NULL,
  "disposition" varchar(20) NOT NULL,
  "reject_reason" varchar(64),
  "recorded_at" timestamp with time zone,
  "received_at" timestamp with time zone NOT NULL,
  "latitude" numeric(10, 8) NOT NULL,
  "longitude" numeric(11, 8) NOT NULL,
  "accuracy_meters" numeric(10, 2),
  "speed_mps" numeric(10, 2),
  "distance_delta_millimeters" integer DEFAULT 0 NOT NULL,
  "gap_before" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "meter_gps_samples_disposition_check"
    CHECK ("disposition" in ('accepted', 'rejected'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_meter_gps_samples_point"
  ON "meter_gps_samples" ("session_id", "client_point_id");

CREATE INDEX IF NOT EXISTS "idx_meter_gps_samples_session_seq"
  ON "meter_gps_samples" ("session_id", "sequence");

CREATE TABLE IF NOT EXISTS "meter_calculation_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL REFERENCES "meter_sessions"("id") ON DELETE RESTRICT,
  "event_type" varchar(64) NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_meter_calculation_events_session"
  ON "meter_calculation_events" ("session_id", "created_at");

CREATE TABLE IF NOT EXISTS "meter_fare_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL REFERENCES "meter_sessions"("id") ON DELETE RESTRICT,
  "rate_schedule_id" uuid NOT NULL REFERENCES "meter_rate_schedules"("id") ON DELETE RESTRICT,
  "rate_snapshot" jsonb NOT NULL,
  "flag_drop_cents" integer NOT NULL,
  "distance_charge_cents" integer NOT NULL,
  "waiting_charge_cents" integer NOT NULL,
  "total_cents" integer NOT NULL,
  "accepted_distance_millimeters" bigint NOT NULL,
  "completed_increments" integer NOT NULL,
  "remainder_micro_miles" integer NOT NULL,
  "waiting_seconds" integer NOT NULL,
  "billable" boolean DEFAULT false NOT NULL,
  "charging_enabled" boolean DEFAULT false NOT NULL,
  "blocked_reasons" jsonb NOT NULL,
  "calculation" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "meter_fare_records_billable_check" CHECK ("billable" = false),
  CONSTRAINT "meter_fare_records_charging_check" CHECK ("charging_enabled" = false),
  CONSTRAINT "meter_fare_records_money_check"
    CHECK (
      "flag_drop_cents" >= 0
      AND "distance_charge_cents" >= 0
      AND "waiting_charge_cents" >= 0
      AND "total_cents" >= 0
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_meter_fare_records_session"
  ON "meter_fare_records" ("session_id");

CREATE TABLE IF NOT EXISTS "meter_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "subject_type" varchar(20) NOT NULL,
  "walk_up_trip_id" uuid REFERENCES "walk_up_trips"("id") ON DELETE RESTRICT,
  "booking_id" uuid REFERENCES "bookings"("id") ON DELETE RESTRICT,
  "meter_session_id" uuid NOT NULL REFERENCES "meter_sessions"("id") ON DELETE RESTRICT,
  "fare_record_id" uuid NOT NULL REFERENCES "meter_fare_records"("id") ON DELETE RESTRICT,
  "currency" varchar(3) NOT NULL,
  "amount_cents" integer NOT NULL,
  "status" varchar(32) NOT NULL,
  "provider" varchar(20) DEFAULT 'stripe' NOT NULL,
  "stripe_checkout_session_id" varchar(255),
  "stripe_payment_intent_id" varchar(255),
  "hosted_url" varchar(2000),
  "receipt_url" varchar(2000),
  "idempotency_key" varchar(120) NOT NULL,
  "failure_code" varchar(100),
  "failure_message" varchar(500),
  "paid_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "meter_payments_subject_check"
    CHECK (
      ("subject_type" = 'walk_up' AND "walk_up_trip_id" IS NOT NULL)
      OR
      ("subject_type" = 'on_demand' AND "booking_id" IS NOT NULL)
    ),
  CONSTRAINT "meter_payments_status_check"
    CHECK ("status" in ('not_billable', 'pending', 'checkout_open', 'paid', 'failed', 'cancelled')),
  CONSTRAINT "meter_payments_amount_check" CHECK ("amount_cents" >= 0),
  CONSTRAINT "meter_payments_provider_check" CHECK ("provider" = 'stripe')
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_meter_payments_idempotency"
  ON "meter_payments" ("idempotency_key");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_meter_payments_checkout"
  ON "meter_payments" ("stripe_checkout_session_id");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_meter_payments_fare"
  ON "meter_payments" ("fare_record_id");

CREATE INDEX IF NOT EXISTS "idx_meter_payments_session"
  ON "meter_payments" ("meter_session_id");

CREATE INDEX IF NOT EXISTS "idx_meter_payments_status"
  ON "meter_payments" ("status");

INSERT INTO "meter_rate_schedules" (
  "code",
  "name",
  "version",
  "status",
  "currency",
  "flag_drop_cents",
  "distance_rate_cents_per_mile",
  "distance_increment_micro_miles",
  "distance_increment_cents",
  "waiting_cents_per_hour",
  "waiting_cents_per_minute",
  "charging_enabled",
  "rules",
  "created_by"
)
SELECT
  'coronado_soft_meter',
  'Coronado soft meter draft',
  1,
  'draft',
  'USD',
  420,
  460,
  100000,
  46,
  3600,
  60,
  false,
  '{
    "partialIncrementRounding": "unconfigured",
    "waitingEligibility": "unconfigured",
    "distanceTimePolicy": "unconfigured",
    "localMeterApproved": false,
    "paymentAuthorizationPolicy": "unconfigured",
    "speedSwitchBelow10Mph": false
  }'::jsonb,
  'system'
WHERE NOT EXISTS (
  SELECT 1 FROM "meter_rate_schedules"
  WHERE "code" = 'coronado_soft_meter' AND "version" = 1
);
