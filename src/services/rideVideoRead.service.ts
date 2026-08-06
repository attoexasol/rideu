import { eq } from 'drizzle-orm';
import { db } from '../db/connection';
import { videoSegments } from '../db/schema';
import { createReadToken, inspectPrivateSegment, verifyStorageToken } from './ride-video-storage.service';
import { RideVideoError } from './rideVideo.errors';

export async function createAdminSegmentReadUrl(segmentId: string) {
  const rows = await db
    .select()
    .from(videoSegments)
    .where(eq(videoSegments.id, segmentId))
    .limit(1);
  const segment = rows[0];
  if (!segment?.storageKey || !['uploaded', 'verified'].includes(segment.uploadStatus)) {
    throw new RideVideoError('VIDEO_SEGMENT_NOT_FOUND', 'Readable video segment not found', 404);
  }
  const authorization = createReadToken({
    segmentId: segment.id,
    storageKey: segment.storageKey,
  });
  return {
    url: `/api/v1/admin/video/segments/${segment.id}/content?token=${authorization.token}`,
    expiresAt: authorization.expiresAt.toISOString(),
  };
}

export async function resolveAdminSegmentReadPath(segmentId: string, token: string) {
  const rows = await db
    .select()
    .from(videoSegments)
    .where(eq(videoSegments.id, segmentId))
    .limit(1);
  const segment = rows[0];
  if (!segment?.storageKey) {
    throw new RideVideoError('VIDEO_SEGMENT_NOT_FOUND', 'Video segment not found', 404);
  }
  try {
    verifyStorageToken(token, {
      purpose: 'read',
      segmentId: segment.id,
      storageKey: segment.storageKey,
    });
  } catch {
    throw new RideVideoError(
      'INVALID_VIDEO_READ_AUTHORIZATION',
      'Video read authorization is invalid or expired',
      403
    );
  }
  const object = await inspectPrivateSegment(segment.storageKey);
  if (!object) throw new RideVideoError('VIDEO_OBJECT_NOT_FOUND', 'Video object not found', 404);
  return { absolutePath: object.absolutePath, mimeType: segment.mimeType };
}
