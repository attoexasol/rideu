import { and, asc, eq, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
import { videoConfig } from '../config/video';
import { db } from '../db/connection';
import { videoSegments, videoSessions } from '../db/schema';
import { logger } from '../middleware/logger';
import { deletePrivateSegment } from './ride-video-storage.service';

/**
 * Intended for a scheduled worker. Safe to retry: rows are marked only after object deletion.
 */
export async function cleanupExpiredRideVideoSegments(batchSize = 100): Promise<{
  scanned: number;
  deleted: number;
  failed: number;
}> {
  const cutoff = new Date(Date.now() - videoConfig.retentionDays * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ segment: videoSegments })
    .from(videoSegments)
    .innerJoin(videoSessions, eq(videoSegments.sessionId, videoSessions.id))
    .where(
      and(
        inArray(videoSessions.status, ['completed', 'cancelled', 'failed']),
        lt(videoSessions.finalizedAt, cutoff),
        isNotNull(videoSegments.storageKey),
        isNull(videoSegments.retentionDeletedAt)
      )
    )
    .orderBy(asc(videoSessions.finalizedAt))
    .limit(Math.max(1, Math.min(batchSize, 1000)));

  let deleted = 0;
  let failed = 0;
  for (const { segment } of rows) {
    try {
      await deletePrivateSegment(segment.storageKey!);
      await db
        .update(videoSegments)
        .set({
          storageKey: null,
          retentionDeletedAt: new Date(),
          failureReason: 'Media deleted by retention policy',
          updatedAt: new Date(),
        })
        .where(and(eq(videoSegments.id, segment.id), isNull(videoSegments.retentionDeletedAt)));
      deleted += 1;
    } catch (error) {
      failed += 1;
      logger.warn({
        event: 'recording.retention_delete_failed',
        bookingId: segment.bookingId,
        sessionId: segment.sessionId,
        segmentId: segment.id,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return { scanned: rows.length, deleted, failed };
}
