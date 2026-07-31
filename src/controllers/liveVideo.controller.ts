import { Request, Response } from 'express';
import { sendSuccess, sendError } from '../utils/response';
import { uploadLiveChunk } from '../services/liveVideo.service';
import { driverUtils } from '../db/utils';

export async function uploadLiveChunkHandler(req: Request, res: Response) {
  try {
    const user = (req as any).user;
    const driver = await driverUtils.findByAuth0Id(user.auth0Id);
    if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);

    const file = (req as any).file;
    if (!file) return sendError(res, 'VALIDATION_ERROR', 'video_file is required', 400);

    const { sessionId, segmentIndex, durationSeconds } = req.body;

    const segment = await uploadLiveChunk({
      sessionId,
      driverId: driver.id,
      buffer: file.buffer,
      mimeType: file.mimetype,
      segmentIndex: Number(segmentIndex),
      durationSeconds: durationSeconds ? Number(durationSeconds) : undefined,
    });

    return sendSuccess(res, segment, 201);
  } catch (e) {
    return sendError(res, 'UPLOAD_FAILED', e instanceof Error ? e.message : 'Upload failed', 400);
  }
}
