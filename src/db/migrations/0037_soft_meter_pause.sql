-- Soft meter pause intervals. Live charging stays disabled.
-- Pause bounds and durations are server-written. Clients cannot supply them.

ALTER TABLE "meter_sessions" DROP CONSTRAINT IF EXISTS "meter_sessions_status_check";
ALTER TABLE "meter_sessions" ADD CONSTRAINT "meter_sessions_status_check"
  CHECK ("status" in ('pending', 'running', 'paused', 'stopped', 'finalized', 'voided'));

DROP INDEX IF EXISTS "uq_meter_sessions_one_open_driver";
CREATE UNIQUE INDEX "uq_meter_sessions_one_open_driver"
  ON "meter_sessions" ("driver_id")
  WHERE "status" in ('pending', 'running', 'paused', 'stopped');

ALTER TABLE "meter_sessions" ADD COLUMN IF NOT EXISTS "paused_at" timestamp with time zone;
ALTER TABLE "meter_sessions" ADD COLUMN IF NOT EXISTS "total_paused_seconds" integer DEFAULT 0 NOT NULL;
ALTER TABLE "meter_sessions" ADD COLUMN IF NOT EXISTS "pause_reason" varchar(40);
ALTER TABLE "meter_sessions" ADD COLUMN IF NOT EXISTS "needs_new_anchor" boolean DEFAULT false NOT NULL;
ALTER TABLE "meter_sessions" ADD COLUMN IF NOT EXISTS "state_version" integer DEFAULT 0 NOT NULL;

ALTER TABLE "meter_sessions" DROP CONSTRAINT IF EXISTS "meter_sessions_pause_check";
ALTER TABLE "meter_sessions" ADD CONSTRAINT "meter_sessions_pause_check"
  CHECK (
    "total_paused_seconds" >= 0
    AND "state_version" >= 0
    AND ("pause_reason" is null OR "pause_reason" = 'driver_personal_stop')
  );

CREATE TABLE IF NOT EXISTS "meter_pauses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL,
  "driver_id" uuid NOT NULL,
  "reason" varchar(40) DEFAULT 'driver_personal_stop' NOT NULL,
  "paused_at" timestamp with time zone NOT NULL,
  "resumed_at" timestamp with time zone,
  "duration_seconds" integer,
  "provisional_total_cents" integer NOT NULL,
  "accepted_distance_millimeters" bigint NOT NULL,
  "waiting_seconds" integer NOT NULL,
  "state_version_at_pause" integer NOT NULL,
  "idempotency_key" varchar(80),
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "meter_pauses_session_fk"
    FOREIGN KEY ("session_id") REFERENCES "meter_sessions"("id") ON DELETE restrict,
  CONSTRAINT "meter_pauses_driver_fk"
    FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE restrict,
  CONSTRAINT "meter_pauses_reason_check"
    CHECK ("reason" = 'driver_personal_stop'),
  CONSTRAINT "meter_pauses_interval_check"
    CHECK ("resumed_at" is null OR "resumed_at" >= "paused_at"),
  CONSTRAINT "meter_pauses_duration_check"
    CHECK ("duration_seconds" is null OR "duration_seconds" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_meter_pauses_one_open"
  ON "meter_pauses" ("session_id")
  WHERE "resumed_at" is null;

CREATE INDEX IF NOT EXISTS "idx_meter_pauses_session"
  ON "meter_pauses" ("session_id", "paused_at");
