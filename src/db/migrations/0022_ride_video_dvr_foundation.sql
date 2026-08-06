-- DVR-style ride video: manifest versioning, partial terminal state, upload activity tracking

ALTER TABLE "video_sessions"
  ADD COLUMN IF NOT EXISTS "manifest_version" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "last_upload_activity_at" timestamp with time zone;

ALTER TABLE "video_sessions" DROP CONSTRAINT IF EXISTS "video_sessions_status_check";

ALTER TABLE "video_sessions"
  ADD CONSTRAINT "video_sessions_status_check"
  CHECK ("status" IN ('pending', 'active', 'paused', 'finalizing', 'completed', 'partial', 'cancelled', 'failed'));

CREATE INDEX IF NOT EXISTS "idx_video_sessions_manifest_version"
  ON "video_sessions" ("manifest_version");

CREATE INDEX IF NOT EXISTS "idx_video_sessions_last_upload_activity"
  ON "video_sessions" ("last_upload_activity_at");
