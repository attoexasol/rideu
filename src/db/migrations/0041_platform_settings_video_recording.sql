-- Global platform flags (single row, id = 1).
-- video_recording_enabled is seeded OFF and is never overwritten by re-runs:
-- the seed uses ON CONFLICT DO NOTHING, so an Admin's later choice persists.

CREATE TABLE IF NOT EXISTS "platform_settings" (
  "id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
  "video_recording_enabled" boolean DEFAULT false NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "updated_by_admin_user_id" uuid,
  "updated_by_auth0_id" varchar(255),
  "updated_by_email" varchar(255),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "platform_settings_singleton_check" CHECK ("id" = 1)
);

DO $$ BEGIN
  ALTER TABLE "platform_settings"
    ADD CONSTRAINT "platform_settings_updated_by_admin_user_id_admin_users_id_fk"
    FOREIGN KEY ("updated_by_admin_user_id") REFERENCES "admin_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO "platform_settings" ("id", "video_recording_enabled", "version")
VALUES (1, false, 1)
ON CONFLICT ("id") DO NOTHING;
