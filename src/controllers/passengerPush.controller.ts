import { Request, Response } from 'express';
import { sendSuccess, sendError } from '../utils/response';
import { findCustomerById } from '../repositories/customer.repository';
import {
  PassengerPushTokenError,
  registerPassengerPushToken,
  unregisterPassengerPushToken,
} from '../services/passengerPushToken.service';

async function resolveCustomer(req: Request) {
  const user = (req as any).user;
  if (!user?.userId) return null;
  return findCustomerById(user.userId);
}

function getRequestSessionId(req: Request): string | undefined {
  const user = (req as any).user;
  if (typeof user?.sessionId === 'string') return user.sessionId;
  const auth = (req as any).auth;
  const payload = auth?.payload || auth;
  return typeof payload?.sessionId === 'string' ? payload.sessionId : undefined;
}

export async function registerPassengerPushTokenHandler(req: Request, res: Response) {
  const customer = await resolveCustomer(req);
  if (!customer) return sendError(res, 'NOT_FOUND', 'Customer not found', 404);

  try {
    const result = await registerPassengerPushToken({
      customer,
      fcmToken: req.body.token,
      requestDeviceId: (req.headers['x-device-id'] as string | undefined) ?? null,
      bodyDeviceId: req.body.deviceId ?? null,
      requestSessionId: getRequestSessionId(req) ?? null,
    });
    return sendSuccess(res, result);
  } catch (error) {
    if (error instanceof PassengerPushTokenError) {
      return sendError(res, error.code, error.message, error.statusCode);
    }
    throw error;
  }
}

export async function unregisterPassengerPushTokenHandler(req: Request, res: Response) {
  const customer = await resolveCustomer(req);
  if (!customer) return sendError(res, 'NOT_FOUND', 'Customer not found', 404);

  try {
    const result = await unregisterPassengerPushToken(customer);
    return sendSuccess(res, result);
  } catch (error) {
    if (error instanceof PassengerPushTokenError) {
      return sendError(res, error.code, error.message, error.statusCode);
    }
    throw error;
  }
}
