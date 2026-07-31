import { Request, Response } from 'express';
import { driverUtils } from '../db/utils';
import { logger } from '../middleware/logger';
import {
  completeRideVideoSegment,
  createAdminSegmentReadUrl,
  createOrRestoreRideVideoSession,
  failRideVideoSegment,
  finalizeRideVideoSession,
  getAdminRideVideoMetadata,
  getRideVideoSessionStatus,
  listRideVideoSegments,
  pauseRideVideoSession,
  registerRideVideoSegment,
  resolveAdminSegmentReadPath,
  resumeRideVideoSession,
  uploadRideVideoSegment,
} from '../services/rideVideo.service';
import { sendSuccess } from '../utils/response';

async function resolveDriverId(req: Request): Promise<string> {
  const auth0Id = (req as any).user?.auth0Id;
  const driver = await driverUtils.findByAuth0Id(auth0Id);
  if (!driver) {
    const error = new Error('Driver not found') as Error & { code: string; statusCode: number };
    error.code = 'DRIVER_NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }
  return driver.id;
}

export async function createVideoSessionHandler(req: Request, res: Response) {
  const driverId = await resolveDriverId(req);
  const session = await createOrRestoreRideVideoSession(req.params.bookingId, driverId);
  return sendSuccess(res, { session });
}

export async function getVideoSessionStatusHandler(req: Request, res: Response) {
  const driverId = await resolveDriverId(req);
  return sendSuccess(res, await getRideVideoSessionStatus(req.params.bookingId, driverId));
}

export async function registerVideoSegmentHandler(req: Request, res: Response) {
  const driverId = await resolveDriverId(req);
  const result = await registerRideVideoSegment(req.params.sessionId, driverId, {
    ...req.body,
    recordedAt: req.body.recordedAt ? new Date(req.body.recordedAt) : undefined,
  });
  return sendSuccess(res, result, 201);
}

export async function uploadRegisteredVideoSegmentHandler(req: Request, res: Response) {
  const driverId = await resolveDriverId(req);
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    const error = new Error('Video request body is required') as Error & {
      code: string;
      statusCode: number;
    };
    error.code = 'VALIDATION_ERROR';
    error.statusCode = 400;
    throw error;
  }
  const segment = await uploadRideVideoSegment({
    segmentId: req.params.segmentId,
    driverId,
    token: String(req.query.token || ''),
    mimeType: req.header('content-type') || '',
    buffer: req.body,
  });
  return sendSuccess(res, { segment });
}

export async function completeVideoSegmentHandler(req: Request, res: Response) {
  const driverId = await resolveDriverId(req);
  const segment = await completeRideVideoSegment(
    req.params.sessionId,
    req.params.segmentId,
    driverId,
    req.body
  );
  return sendSuccess(res, { segment });
}

export async function failVideoSegmentHandler(req: Request, res: Response) {
  const driverId = await resolveDriverId(req);
  return sendSuccess(
    res,
    await failRideVideoSegment(
      req.params.sessionId,
      req.params.segmentId,
      driverId,
      req.body.reason
    )
  );
}

export async function listVideoSegmentsHandler(req: Request, res: Response) {
  const driverId = await resolveDriverId(req);
  const segments = await listRideVideoSegments(
    req.params.sessionId,
    driverId,
    req.query.status as string | undefined
  );
  return sendSuccess(res, { segments });
}

export async function pauseVideoSessionHandler(req: Request, res: Response) {
  const driverId = await resolveDriverId(req);
  return sendSuccess(res, {
    session: await pauseRideVideoSession(req.params.sessionId, driverId),
  });
}

export async function resumeVideoSessionHandler(req: Request, res: Response) {
  const driverId = await resolveDriverId(req);
  return sendSuccess(res, {
    session: await resumeRideVideoSession(req.params.sessionId, driverId),
  });
}

export async function finalizeVideoSessionHandler(req: Request, res: Response) {
  const driverId = await resolveDriverId(req);
  return sendSuccess(res, {
    session: await finalizeRideVideoSession(req.params.sessionId, driverId),
  });
}

export async function adminBookingVideoHandler(req: Request, res: Response) {
  logger.info({
    event: 'recording.admin_metadata_access',
    bookingId: req.params.bookingId,
    adminAuth0Id: (req as any).user?.auth0Id,
  });
  return sendSuccess(res, await getAdminRideVideoMetadata(req.params.bookingId));
}

export async function adminVideoReadUrlHandler(req: Request, res: Response) {
  logger.info({
    event: 'recording.admin_read_url_created',
    segmentId: req.params.segmentId,
    adminAuth0Id: (req as any).user?.auth0Id,
  });
  return sendSuccess(res, await createAdminSegmentReadUrl(req.params.segmentId));
}

export async function adminVideoContentHandler(req: Request, res: Response) {
  const object = await resolveAdminSegmentReadPath(
    req.params.segmentId,
    String(req.query.token || '')
  );
  res.type(object.mimeType);
  res.setHeader('Cache-Control', 'private, no-store');
  return res.sendFile(object.absolutePath);
}
