-- Upgrade the existing video tables in place. No booking or media metadata is deleted.
ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "recording_consent_status" varchar(30) DEFAULT 'required' NOT NULL,
  ADD COLUMN IF NOT EXISTS "recording_consent_revoked_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "recording_consent_version" varchar(50) DEFAULT 'v1';
ALTER TABLE "bookings"
  ALTER COLUMN "recording_consented_at" TYPE timestamptz
  USING "recording_consented_at" AT TIME ZONE 'UTC';

UPDATE "bookings"
SET "recording_consent_status" = CASE
  WHEN "recording_consented_at" IS NOT NULL THEN 'granted'
  ELSE 'required'
END;
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_recording_consent_status_check";
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_recording_consent_status_check"
  CHECK ("recording_consent_status" IN ('required', 'granted', 'denied', 'not_required'));

ALTER TABLE "video_sessions"
  ALTER COLUMN "trip_id" DROP NOT NULL,
  ALTER COLUMN "trip_id" DROP DEFAULT,
  ALTER COLUMN "status" SET DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "passenger_id" uuid REFERENCES "customers"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "consent_status" varchar(30) DEFAULT 'required' NOT NULL,
  ADD COLUMN IF NOT EXISTS "paused_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "finalized_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "failure_reason" text;

ALTER TABLE "video_sessions" DROP CONSTRAINT IF EXISTS "video_sessions_trip_id_trips_id_fk";
ALTER TABLE "video_sessions"
  ADD CONSTRAINT "video_sessions_trip_id_trips_id_fk"
  FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE SET NULL;
ALTER TABLE "video_sessions" DROP CONSTRAINT IF EXISTS "video_sessions_booking_id_bookings_id_fk";
ALTER TABLE "video_sessions"
  ADD CONSTRAINT "video_sessions_booking_id_bookings_id_fk"
  FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT;
ALTER TABLE "video_sessions" DROP CONSTRAINT IF EXISTS "video_sessions_driver_id_drivers_id_fk";
ALTER TABLE "video_sessions"
  ADD CONSTRAINT "video_sessions_driver_id_drivers_id_fk"
  FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT;

UPDATE "video_sessions" AS s
SET "booking_id" = t."booking_id"
FROM "trips" AS t
WHERE s."trip_id" = t."id" AND s."booking_id" IS NULL AND t."booking_id" IS NOT NULL;

UPDATE "video_sessions" AS s
SET
  "passenger_id" = b."customer_id",
  "consent_status" = CASE
    WHEN b."recording_consent_status" = 'granted' THEN 'granted'
    WHEN b."recording_consent_status" = 'denied' THEN 'denied'
    ELSE 'required'
  END
FROM "bookings" AS b
WHERE s."booking_id" = b."id";

UPDATE "video_sessions" SET "status" = 'completed' WHERE "status" = 'ended';
UPDATE "video_sessions" SET "started_at" = COALESCE("started_at", "created_at", now());

ALTER TABLE "video_sessions"
  ALTER COLUMN "started_at" DROP NOT NULL,
  ALTER COLUMN "started_at" DROP DEFAULT,
  ALTER COLUMN "started_at" TYPE timestamptz USING "started_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "ended_at" TYPE timestamptz USING "ended_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';

ALTER TABLE "video_sessions" DROP CONSTRAINT IF EXISTS "video_sessions_status_check";
ALTER TABLE "video_sessions"
  ADD CONSTRAINT "video_sessions_status_check"
  CHECK ("status" IN ('pending', 'active', 'paused', 'finalizing', 'completed', 'cancelled', 'failed'));
ALTER TABLE "video_sessions" DROP CONSTRAINT IF EXISTS "video_sessions_consent_status_check";
ALTER TABLE "video_sessions"
  ADD CONSTRAINT "video_sessions_consent_status_check"
  CHECK ("consent_status" IN ('required', 'granted', 'denied', 'not_required'));
ALTER TABLE "video_sessions" DROP CONSTRAINT IF EXISTS "video_sessions_booking_required";
ALTER TABLE "video_sessions"
  ADD CONSTRAINT "video_sessions_booking_required" CHECK ("booking_id" IS NOT NULL) NOT VALID;

WITH ranked AS (
  SELECT "id", row_number() OVER (
    PARTITION BY "booking_id", "driver_id"
    ORDER BY "created_at" DESC, "id" DESC
  ) AS rn
  FROM "video_sessions"
  WHERE "booking_id" IS NOT NULL
    AND "status" IN ('pending', 'active', 'paused', 'finalizing')
)
UPDATE "video_sessions" AS s
SET "status" = 'failed',
    "failure_reason" = COALESCE(s."failure_reason", 'Superseded during recording migration'),
    "ended_at" = COALESCE(s."ended_at", now()),
    "updated_at" = now()
FROM ranked
WHERE s."id" = ranked."id" AND ranked.rn > 1;

CREATE INDEX IF NOT EXISTS "idx_video_sessions_driver" ON "video_sessions" ("driver_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_video_sessions_booking_driver_recoverable"
  ON "video_sessions" ("booking_id", "driver_id")
  WHERE "status" IN ('pending', 'active', 'paused', 'finalizing');

ALTER TABLE "video_segments"
  ADD COLUMN IF NOT EXISTS "booking_id" uuid,
  ADD COLUMN IF NOT EXISTS "driver_id" uuid,
  ADD COLUMN IF NOT EXISTS "client_segment_id" text,
  ADD COLUMN IF NOT EXISTS "storage_key" text,
  ADD COLUMN IF NOT EXISTS "upload_status" text DEFAULT 'pending' NOT NULL,
  ADD COLUMN IF NOT EXISTS "duration_ms" integer,
  ADD COLUMN IF NOT EXISTS "checksum" text,
  ADD COLUMN IF NOT EXISTS "recorded_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "uploaded_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "retention_deleted_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "retry_count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "failure_reason" text,
  ADD COLUMN IF NOT EXISTS "updated_at" timestamptz DEFAULT now() NOT NULL;

UPDATE "video_segments" AS seg
SET
  "booking_id" = session."booking_id",
  "driver_id" = session."driver_id",
  "client_segment_id" = COALESCE(seg."client_segment_id", 'legacy-' || seg."id"::text),
  "storage_key" = COALESCE(seg."storage_key", seg."video_url"),
  "upload_status" = CASE WHEN seg."video_url" IS NOT NULL THEN 'verified' ELSE 'pending' END,
  "duration_ms" = COALESCE(seg."duration_ms", seg."duration_seconds" * 1000),
  "uploaded_at" = CASE WHEN seg."video_url" IS NOT NULL THEN seg."created_at" AT TIME ZONE 'UTC' ELSE NULL END
FROM "video_sessions" AS session
WHERE seg."session_id" = session."id";

ALTER TABLE "video_segments"
  ALTER COLUMN "video_url" DROP NOT NULL,
  ALTER COLUMN "mime_type" SET DEFAULT 'video/mp4';
UPDATE "video_segments" SET "mime_type" = 'video/mp4' WHERE "mime_type" IS NULL;
ALTER TABLE "video_segments"
  ALTER COLUMN "mime_type" SET NOT NULL,
  ALTER COLUMN "client_segment_id" SET NOT NULL,
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';

ALTER TABLE "video_segments" DROP CONSTRAINT IF EXISTS "video_segments_booking_id_bookings_id_fk";
ALTER TABLE "video_segments"
  ADD CONSTRAINT "video_segments_booking_id_bookings_id_fk"
  FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT;
ALTER TABLE "video_segments" DROP CONSTRAINT IF EXISTS "video_segments_driver_id_drivers_id_fk";
ALTER TABLE "video_segments"
  ADD CONSTRAINT "video_segments_driver_id_drivers_id_fk"
  FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT;
ALTER TABLE "video_segments" DROP CONSTRAINT IF EXISTS "video_segments_booking_required";
ALTER TABLE "video_segments"
  ADD CONSTRAINT "video_segments_booking_required" CHECK ("booking_id" IS NOT NULL) NOT VALID;
ALTER TABLE "video_segments" DROP CONSTRAINT IF EXISTS "video_segments_driver_required";
ALTER TABLE "video_segments"
  ADD CONSTRAINT "video_segments_driver_required" CHECK ("driver_id" IS NOT NULL) NOT VALID;
ALTER TABLE "video_segments" DROP CONSTRAINT IF EXISTS "video_segments_upload_status_check";
ALTER TABLE "video_segments"
  ADD CONSTRAINT "video_segments_upload_status_check"
  CHECK ("upload_status" IN ('pending', 'uploading', 'uploaded', 'verified', 'failed'));
ALTER TABLE "video_segments" DROP CONSTRAINT IF EXISTS "video_segments_sequence_check";
ALTER TABLE "video_segments"
  ADD CONSTRAINT "video_segments_sequence_check" CHECK ("segment_index" >= 0);
ALTER TABLE "video_segments" DROP CONSTRAINT IF EXISTS "video_segments_duration_check";
ALTER TABLE "video_segments"
  ADD CONSTRAINT "video_segments_duration_check" CHECK ("duration_ms" IS NULL OR "duration_ms" >= 0);
ALTER TABLE "video_segments" DROP CONSTRAINT IF EXISTS "video_segments_size_check";
ALTER TABLE "video_segments"
  ADD CONSTRAINT "video_segments_size_check" CHECK ("file_size" IS NULL OR "file_size" >= 0);
ALTER TABLE "video_segments" DROP CONSTRAINT IF EXISTS "video_segments_retry_check";
ALTER TABLE "video_segments"
  ADD CONSTRAINT "video_segments_retry_check" CHECK ("retry_count" >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_video_segments_session_sequence"
  ON "video_segments" ("session_id", "segment_index");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_video_segments_session_client_id"
  ON "video_segments" ("session_id", "client_segment_id");
CREATE INDEX IF NOT EXISTS "idx_video_segments_booking" ON "video_segments" ("booking_id");
CREATE INDEX IF NOT EXISTS "idx_video_segments_upload_status" ON "video_segments" ("upload_status");
