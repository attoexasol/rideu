import fs from 'fs/promises';
import { db } from '../db/connection';
import { drivers } from '../db/schema/drivers';
import { eq } from 'drizzle-orm';
import { isAdmin } from '../middleware/rbac';
import {
  createTripVideo,
  deleteTripVideoById,
  findTripById,
  findTripVideoById,
  findTripVideosByTripId,
  storageKeyFromRecord,
  TripVideoRecord,
} from '../repositories/tripVideo.repository';
import { getVideoStorageService, sanitizeOriginalName } from './video-storage.service';

export interface UploadTripVideoInput {
  tripId: string;
  driverUserId: string;
  auth0Id: string;
  role?: string;
  tempFilePath: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  startTime: string;
  endTime: string;
  duration: number;
}

export interface TripVideoListItem {
  id: string;
  videoUrl: string;
  duration: number;
}

export interface TripVideoMetadata {
  id: string;
  tripId: string;
  driverId: string;
  fileName: string | null;
  originalName: string | null;
  videoUrl: string | null;
  mimeType: string | null;
  fileSize: number | null;
  durationSeconds: number | null;
  startedAt: Date | null;
  endedAt: Date | null;
  uploadStatus: string;
  createdAt: Date;
  updatedAt: Date;
}

async function resolveDriverId(userId: string, auth0Id: string): Promise<string | null> {
  if (userId) {
    const byId = await db.query.drivers.findFirst({ where: eq(drivers.id, userId) });
    if (byId) return byId.id;
  }
  const byAuth = await db.query.drivers.findFirst({ where: eq(drivers.auth0Id, auth0Id) });
  return byAuth?.id ?? null;
}

async function assertTripVideoAccess(
  tripId: string,
  userId: string,
  auth0Id: string,
  role?: string
): Promise<{ tripDriverId: string; requesterDriverId: string | null }> {
  const trip = await findTripById(tripId);
  if (!trip) {
    throw new Error('Trip not found');
  }

  if (isAdmin(role)) {
    return { tripDriverId: trip.driver_id, requesterDriverId: null };
  }

  const driverId = await resolveDriverId(userId, auth0Id);
  if (!driverId || driverId !== trip.driver_id) {
    throw new Error('You do not have access to this trip');
  }

  return { tripDriverId: trip.driver_id, requesterDriverId: driverId };
}

function mapListItem(record: TripVideoRecord): TripVideoListItem {
  return {
    id: record.id,
    videoUrl: record.video_url ?? '',
    duration: record.duration_seconds ?? 0,
  };
}

function mapMetadata(record: TripVideoRecord): TripVideoMetadata {
  return {
    id: record.id,
    tripId: record.trip_id,
    driverId: record.driver_id,
    fileName: record.file_name,
    originalName: record.original_name,
    videoUrl: record.video_url,
    mimeType: record.mime_type,
    fileSize: record.file_size,
    durationSeconds: record.duration_seconds,
    startedAt: record.started_at,
    endedAt: record.ended_at,
    uploadStatus: record.upload_status,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

export async function uploadTripVideo(input: UploadTripVideoInput) {
  console.log('[VideoService] uploadTripVideo:start', {
    tripId: input.tripId,
    startTime: input.startTime,
    endTime: input.endTime,
    duration: input.duration,
    fileSize: input.fileSize,
    mimeType: input.mimeType,
  });

  const access = await assertTripVideoAccess(
    input.tripId,
    input.driverUserId,
    input.auth0Id,
    input.role
  );
  console.log('[VideoService] uploadTripVideo:tripAccessOk', {
    tripDriverId: access.tripDriverId,
    requesterDriverId: access.requesterDriverId,
  });

  const driverId = access.requesterDriverId ?? access.tripDriverId;
  if (!isAdmin(input.role) && driverId !== access.tripDriverId) {
    throw new Error('You can only upload videos for your own trips');
  }

  const storage = getVideoStorageService();
  let stored;

  try {
    console.log('[VideoService] uploadTripVideo:storageUpload:start', {
      tempFilePath: input.tempFilePath,
      originalName: sanitizeOriginalName(input.originalName),
    });
    stored = await storage.uploadVideo({
      tempFilePath: input.tempFilePath,
      originalName: sanitizeOriginalName(input.originalName),
      mimeType: input.mimeType,
    });
    console.log('[VideoService] uploadTripVideo:storageUpload:done', stored);
  } catch (error) {
    await fs.unlink(input.tempFilePath).catch(() => undefined);
    throw error;
  }

  console.log('[VideoService] uploadTripVideo:dbInsert:start', {
    startedAt: input.startTime,
    endedAt: input.endTime,
    durationSeconds: Math.round(input.duration),
  });

  const record = await createTripVideo({
    tripId: input.tripId,
    driverId: access.tripDriverId,
    fileName: stored.fileName,
    originalName: sanitizeOriginalName(input.originalName),
    videoUrl: stored.videoUrl,
    mimeType: input.mimeType,
    fileSize: input.fileSize,
    durationSeconds: Math.round(input.duration),
    startedAt: input.startTime,
    endedAt: input.endTime,
  });

  console.log('[VideoService] uploadTripVideo:dbInsert:done', { videoId: record.id });

  return {
    videoId: record.id,
    videoUrl: record.video_url!,
    tripId: record.trip_id,
  };
}

export async function listTripVideos(
  tripId: string,
  userId: string,
  auth0Id: string,
  role?: string
): Promise<TripVideoListItem[]> {
  await assertTripVideoAccess(tripId, userId, auth0Id, role);
  const rows = await findTripVideosByTripId(tripId);
  return rows.map(mapListItem);
}

export async function getTripVideoMetadata(
  videoId: string,
  userId: string,
  auth0Id: string,
  role?: string
): Promise<TripVideoMetadata> {
  const record = await findTripVideoById(videoId);
  if (!record) {
    throw new Error('Video not found');
  }

  await assertTripVideoAccess(record.trip_id, userId, auth0Id, role);
  return mapMetadata(record);
}

export async function deleteTripVideo(videoId: string): Promise<void> {
  const record = await deleteTripVideoById(videoId);
  if (!record) {
    throw new Error('Video not found');
  }

  const storageKey = storageKeyFromRecord(record);
  if (storageKey) {
    await getVideoStorageService().deleteVideo(storageKey);
  }
}
