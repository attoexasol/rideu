CREATE TABLE IF NOT EXISTS "trip_videos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "trip_id" uuid NOT NULL REFERENCES "trips"("id") ON DELETE CASCADE,
  "driver_id" uuid NOT NULL REFERENCES "drivers"("id") ON DELETE CASCADE,
  "file_name" text,
  "original_name" text,
  "video_url" text,
  "mime_type" text,
  "file_size" bigint,
  "duration_seconds" integer,
  "started_at" timestamp,
  "ended_at" timestamp,
  "upload_status" varchar(20) DEFAULT 'uploaded' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_trip_videos_trip_id" ON "trip_videos" ("trip_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_trip_videos_driver_id" ON "trip_videos" ("driver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_trip_videos_created_at" ON "trip_videos" ("created_at" DESC);
