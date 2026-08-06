-- Admin ride-video API: audit trail + list/filter indexes

CREATE TABLE IF NOT EXISTS "ride_video_audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid,
  "booking_id" uuid,
  "admin_user_id" uuid,
  "admin_auth0_id" varchar(255),
  "admin_email" varchar(255),
  "action" varchar(100) NOT NULL,
  "result" varchar(50) DEFAULT 'success' NOT NULL,
  "reason" text,
  "segment_id" uuid,
  "ip_address" varchar(100),
  "user_agent" varchar(500),
  "metadata" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "ride_video_audit_events"
    ADD CONSTRAINT "ride_video_audit_events_session_id_video_sessions_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "video_sessions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ride_video_audit_events"
    ADD CONSTRAINT "ride_video_audit_events_booking_id_bookings_id_fk"
    FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ride_video_audit_events"
    ADD CONSTRAINT "ride_video_audit_events_admin_user_id_admin_users_id_fk"
    FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "idx_ride_video_audit_session"
  ON "ride_video_audit_events" ("session_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_ride_video_audit_booking"
  ON "ride_video_audit_events" ("booking_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_ride_video_audit_action"
  ON "ride_video_audit_events" ("action");
CREATE INDEX IF NOT EXISTS "idx_ride_video_audit_created_at"
  ON "ride_video_audit_events" ("created_at");

CREATE INDEX IF NOT EXISTS "idx_video_sessions_created_at"
  ON "video_sessions" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_video_sessions_finalized_at"
  ON "video_sessions" ("finalized_at");
CREATE INDEX IF NOT EXISTS "idx_video_sessions_passenger"
  ON "video_sessions" ("passenger_id");
CREATE INDEX IF NOT EXISTS "idx_video_sessions_consent_status"
  ON "video_sessions" ("consent_status");
CREATE INDEX IF NOT EXISTS "idx_video_segments_retention_deleted"
  ON "video_segments" ("retention_deleted_at");
