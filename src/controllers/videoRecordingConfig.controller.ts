import { Request, Response } from 'express';
import {
  getAdminVideoRecordingConfig,
  getDriverVideoRecordingConfig,
  updateVideoRecordingConfig,
} from '../services/videoRecordingPolicy.service';
import { sendSuccess } from '../utils/response';

interface RequestUser {
  auth0Id?: string;
  email?: string;
}

export async function getAdminVideoRecordingConfigHandler(_req: Request, res: Response) {
  return sendSuccess(res, await getAdminVideoRecordingConfig());
}

export async function patchAdminVideoRecordingConfigHandler(req: Request, res: Response) {
  const user = (req as Request & { user?: RequestUser }).user || {};
  const body = req.body as { enabled: boolean; expectedVersion?: number };
  const data = await updateVideoRecordingConfig({
    enabled: body.enabled,
    expectedVersion: body.expectedVersion,
    actor: {
      auth0Id: user.auth0Id,
      email: user.email,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || undefined,
    },
  });
  return sendSuccess(res, data);
}

export async function getDriverVideoRecordingConfigHandler(_req: Request, res: Response) {
  res.setHeader('Cache-Control', 'no-store');
  return sendSuccess(res, await getDriverVideoRecordingConfig());
}
