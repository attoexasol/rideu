import { Request, Response } from 'express';
import { sendSuccess, sendError } from '../utils/response';
import { driverUtils } from '../db/utils';
import {
  DriverPushTokenError,
  registerDriverPushToken,
  unregisterDriverPushToken,
} from '../services/driverPushToken.service';

async function resolveDriver(req: Request) {
  const user = (req as any).user;
  return driverUtils.findByAuth0Id(user.auth0Id);
}

function getRequestSessionId(req: Request): string | undefined {
  const auth = (req as any).auth;
  const payload = auth?.payload || auth;
  return typeof payload?.sessionId === 'string' ? payload.sessionId : undefined;
}

export async function registerPushTokenHandler(req: Request, res: Response) {
  const driver = await resolveDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);

  try {
    const result = await registerDriverPushToken({
      driver,
      fcmToken: req.body.token,
      requestDeviceId: (req.headers['x-device-id'] as string | undefined) ?? null,
      bodyDeviceId: req.body.deviceId ?? null,
      requestSessionId: getRequestSessionId(req) ?? null,
    });
    return sendSuccess(res, result);
  } catch (error) {
    if (error instanceof DriverPushTokenError) {
      return sendError(res, error.code, error.message, error.statusCode);
    }
    throw error;
  }
}

export async function unregisterPushTokenHandler(req: Request, res: Response) {
  const driver = await resolveDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);

  try {
    const result = await unregisterDriverPushToken(driver);
    return sendSuccess(res, result);
  } catch (error) {
    if (error instanceof DriverPushTokenError) {
      return sendError(res, error.code, error.message, error.statusCode);
    }
    throw error;
  }
}
