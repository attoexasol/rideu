-- Trip video metadata (files stored in object storage / local uploads/)
-- Applied via migration 0010_trip_videos.sql

CREATE TABLE IF NOT EXISTS trip_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  file_name TEXT,
  original_name TEXT,
  video_url TEXT,
  mime_type TEXT,
  file_size BIGINT,
  duration_seconds INTEGER,
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  upload_status VARCHAR(20) DEFAULT 'uploaded',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trip_videos_trip_id ON trip_videos(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_videos_driver_id ON trip_videos(driver_id);
CREATE INDEX IF NOT EXISTS idx_trip_videos_created_at ON trip_videos(created_at DESC);
