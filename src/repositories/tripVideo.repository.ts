import { queryClient } from '../db/connection';

export interface TripVideoRecord {
  id: string;
  trip_id: string;
  driver_id: string;
  file_name: string | null;
  original_name: string | null;
  video_url: string | null;
  mime_type: string | null;
  file_size: number | null;
  duration_seconds: number | null;
  started_at: Date | null;
  ended_at: Date | null;
  upload_status: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateTripVideoInput {
  tripId: string;
  driverId: string;
  fileName: string;
  originalName: string;
  videoUrl: string;
  mimeType: string;
  fileSize: number;
  durationSeconds: number;
  startedAt: Date | string;
  endedAt: Date | string;
}

function toTimestampParam(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export async function findTripById(
  tripId: string
): Promise<{ id: string; driver_id: string } | null> {
  const rows = await queryClient<{ id: string; driver_id: string }[]>`
    SELECT id, driver_id FROM trips WHERE id = ${tripId} LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function createTripVideo(input: CreateTripVideoInput): Promise<TripVideoRecord> {
  const startedAt = toTimestampParam(input.startedAt);
  const endedAt = toTimestampParam(input.endedAt);

  console.log('[TripVideoRepository] createTripVideo', {
    tripId: input.tripId,
    driverId: input.driverId,
    fileName: input.fileName,
    fileSize: input.fileSize,
    durationSeconds: input.durationSeconds,
    startedAt,
    endedAt,
  });

  const rows = await queryClient<TripVideoRecord[]>`
    INSERT INTO trip_videos (
      trip_id, driver_id, file_name, original_name, video_url, mime_type,
      file_size, duration_seconds, started_at, ended_at, upload_status
    ) VALUES (
      ${input.tripId},
      ${input.driverId},
      ${input.fileName},
      ${input.originalName},
      ${input.videoUrl},
      ${input.mimeType},
      ${input.fileSize},
      ${input.durationSeconds},
      ${startedAt},
      ${endedAt},
      'uploaded'
    )
    RETURNING
      id, trip_id, driver_id, file_name, original_name, video_url, mime_type,
      file_size, duration_seconds, started_at, ended_at, upload_status,
      created_at, updated_at
  `;
  if (!rows[0]) throw new Error('Failed to create trip video record');
  return rows[0];
}

export async function findTripVideosByTripId(tripId: string): Promise<TripVideoRecord[]> {
  return queryClient<TripVideoRecord[]>`
    SELECT
      id, trip_id, driver_id, file_name, original_name, video_url, mime_type,
      file_size, duration_seconds, started_at, ended_at, upload_status,
      created_at, updated_at
    FROM trip_videos
    WHERE trip_id = ${tripId}
    ORDER BY created_at DESC
  `;
}

export async function findTripVideoById(videoId: string): Promise<TripVideoRecord | null> {
  const rows = await queryClient<TripVideoRecord[]>`
    SELECT
      id, trip_id, driver_id, file_name, original_name, video_url, mime_type,
      file_size, duration_seconds, started_at, ended_at, upload_status,
      created_at, updated_at
    FROM trip_videos
    WHERE id = ${videoId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function deleteTripVideoById(videoId: string): Promise<TripVideoRecord | null> {
  const rows = await queryClient<TripVideoRecord[]>`
    DELETE FROM trip_videos
    WHERE id = ${videoId}
    RETURNING
      id, trip_id, driver_id, file_name, original_name, video_url, mime_type,
      file_size, duration_seconds, started_at, ended_at, upload_status,
      created_at, updated_at
  `;
  return rows[0] ?? null;
}

export function storageKeyFromRecord(record: TripVideoRecord): string {
  if (!record.file_name) return '';
  const created = record.created_at ?? new Date();
  const year = String(created.getUTCFullYear());
  const month = String(created.getUTCMonth() + 1).padStart(2, '0');
  return `videos/${year}/${month}/${record.file_name}`;
}
