import { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection';
import { videoSegments } from '../db/schema';
import { driverUtils } from '../db/utils';
import { logger } from './logger';
import { StorageTokenError, verifyStorageToken } from '../services/ride-video-storage.service';
import { RideVideoError } from '../services/rideVideo.errors';

declare module 'express-serve-static-core' {
  interface Request {
    uploadRequestStartedAt?: number;
    uploadTokenValidated?: boolean;
  }
}

/**
 * Validates signed upload token before express.raw reads the segment body.
 * Uses request-start time so slow uploads are not rejected if the token was
 * valid when the PUT began.
 */
export async function validateUploadTokenBeforeBody(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  req.uploadRequestStartedAt = Math.floor(Date.now() / 1000);
  const token = String(req.query.token || '');
  const segmentId = req.params.segmentId;
  const auth0Id = (req as any).user?.auth0Id;
  if (!auth0Id || !segmentId || !token) {
    return next(
      new RideVideoError(
        'INVALID_VIDEO_UPLOAD_AUTHORIZATION',
        'Video upload authorization is invalid or expired',
        403
      )
    );
  }

  const driver = await driverUtils.findByAuth0Id(auth0Id);
  if (!driver) {
    return next(new RideVideoError('DRIVER_NOT_FOUND', 'Driver not found', 404));
  }

  const rows = await db
    .select()
    .from(videoSegments)
    .where(eq(videoSegments.id, segmentId))
    .limit(1);
  const segment = rows[0];
  if (!segment?.storageKey) {
    return next(new RideVideoError('VIDEO_SEGMENT_NOT_FOUND', 'Video segment not found', 404));
  }
  if (segment.driverId !== driver.id) {
    return next(new RideVideoError('FORBIDDEN', 'Video segment belongs to another driver', 403));
  }

  try {
    verifyStorageToken(token, {
      purpose: 'upload',
      segmentId: segment.id,
      storageKey: segment.storageKey,
      driverId: driver.id,
      validAt: req.uploadRequestStartedAt,
    });
    req.uploadTokenValidated = true;
    next();
  } catch (error) {
    const reason = error instanceof StorageTokenError ? error.reason : 'malformed';
    logger.warn({
      event: 'recording.upload_token_rejected',
      segmentId,
      sessionId: segment.sessionId,
      bookingId: segment.bookingId,
      segmentIndex: segment.sequenceNumber,
      tokenFailureReason: reason,
      uploadRequestStartedAt: req.uploadRequestStartedAt,
    });
    const code =
      reason === 'expired' ? 'VIDEO_UPLOAD_TOKEN_EXPIRED' : 'INVALID_VIDEO_UPLOAD_AUTHORIZATION';
    next(
      new RideVideoError(
        code,
        reason === 'expired'
          ? 'Video upload authorization expired before upload could start; re-register the segment for a fresh URL'
          : 'Video upload authorization is invalid or expired',
        403
      )
    );
  }
}
