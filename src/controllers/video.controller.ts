import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import {
  deleteTripVideo,
  getTripVideoMetadata,
  listTripVideos,
  uploadTripVideo,
} from '../services/video.service';
import { sendError, sendNotFound, sendSuccess } from '../utils/response';
import { videoUploadBodySchema } from '../validators';
import { handleMulterError } from '../middleware/upload';
import fs from 'fs/promises';

function getUser(req: AuthenticatedRequest) {
  return (req as any).user as {
    userId?: string;
    auth0Id?: string;
    role?: string;
  };
}

export async function uploadVideoHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> {
  const user = getUser(req);
  const file = req.file;

  if (!file) {
    return sendError(res, 'VALIDATION_ERROR', 'video_file is required', 400);
  }

  const parsed = videoUploadBodySchema.safeParse(req.body);
  if (!parsed.success) {
    await fs.unlink(file.path).catch(() => undefined);
    return sendError(
      res,
      'VALIDATION_ERROR',
      'Invalid upload metadata',
      400,
      parsed.error.flatten()
    );
  }

  console.log('[VideoController] uploadVideoHandler:validated', {
    tripId: parsed.data.tripId,
    startTime: parsed.data.startTime,
    endTime: parsed.data.endTime,
    duration: parsed.data.duration,
    startTimeType: typeof parsed.data.startTime,
    endTimeType: typeof parsed.data.endTime,
    fileName: file.originalname,
    fileSize: file.size,
    mimeType: file.mimetype,
  });

  try {
    const result = await uploadTripVideo({
      tripId: parsed.data.tripId,
      driverUserId: user.userId ?? '',
      auth0Id: user.auth0Id ?? '',
      role: user.role,
      tempFilePath: file.path,
      originalName: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.size,
      startTime: parsed.data.startTime,
      endTime: parsed.data.endTime,
      duration: parsed.data.duration,
    });

    return sendSuccess(res, result, 201);
  } catch (error) {
    await fs.unlink(file.path).catch(() => undefined);
    const message = error instanceof Error ? error.message : 'Upload failed';
    const status = message.includes('not found')
      ? 404
      : message.includes('access') || message.includes('own')
        ? 403
        : 400;
    return sendError(
      res,
      status === 404 ? 'NOT_FOUND' : status === 403 ? 'UNAUTHORIZED' : 'VALIDATION_ERROR',
      message,
      status
    );
  }
}

export async function listTripVideosHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> {
  const { tripId } = req.params;
  const user = getUser(req);

  try {
    const videos = await listTripVideos(tripId, user.userId ?? '', user.auth0Id ?? '', user.role);
    return sendSuccess(res, videos);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list videos';
    const status = message.includes('not found') ? 404 : message.includes('access') ? 403 : 500;
    return sendError(
      res,
      status === 404 ? 'NOT_FOUND' : status === 403 ? 'UNAUTHORIZED' : 'SERVER_ERROR',
      message,
      status
    );
  }
}

export async function getVideoHandler(req: AuthenticatedRequest, res: Response): Promise<Response> {
  const { videoId } = req.params;
  const user = getUser(req);

  try {
    const metadata = await getTripVideoMetadata(
      videoId,
      user.userId ?? '',
      user.auth0Id ?? '',
      user.role
    );
    return sendSuccess(res, metadata);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get video';
    if (message.includes('not found')) return sendNotFound(res, 'Video');
    if (message.includes('access')) {
      return sendError(res, 'UNAUTHORIZED', message, 403);
    }
    return sendError(res, 'SERVER_ERROR', message, 500);
  }
}

export async function deleteVideoHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> {
  const { videoId } = req.params;

  try {
    await deleteTripVideo(videoId);
    return sendSuccess(res, { message: 'Video deleted successfully' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete video';
    if (message.includes('not found')) return sendNotFound(res, 'Video');
    return sendError(res, 'SERVER_ERROR', message, 500);
  }
}

export function multerErrorWrapper(
  err: unknown,
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  handleMulterError(err, req, res, next);
}
