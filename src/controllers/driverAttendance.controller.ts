import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import {
  driverCheckIn,
  driverCheckOut,
  getDriverAttendanceStatus,
} from '../services/driverAttendance.service';
import { canActOnDriver } from '../utils/driverAccess';
import { sendError, sendNotFound, sendSuccess } from '../utils/response';

export async function checkInHandler(req: AuthenticatedRequest, res: Response): Promise<Response> {
  const { driverId, qrCode, location } = req.body;

  const access = await canActOnDriver(req, driverId);
  if (!access.driver) {
    return sendNotFound(res, 'Driver');
  }
  if (!access.allowed) {
    return sendError(res, 'UNAUTHORIZED', 'You cannot check in for this driver', 403);
  }

  try {
    const result = await driverCheckIn(driverId, qrCode, location);
    return sendSuccess(res, {
      message: 'Check-in successful',
      attendance: result.attendance,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Check-in failed';
    return sendError(res, 'VALIDATION_ERROR', message, 400);
  }
}

export async function checkOutHandler(req: AuthenticatedRequest, res: Response): Promise<Response> {
  const { driverId, qrCode } = req.body;

  const access = await canActOnDriver(req, driverId);
  if (!access.driver) {
    return sendNotFound(res, 'Driver');
  }
  if (!access.allowed) {
    return sendError(res, 'UNAUTHORIZED', 'You cannot check out for this driver', 403);
  }

  try {
    const result = await driverCheckOut(driverId, qrCode);
    return sendSuccess(res, {
      message: 'Check-out successful',
      attendance: result.attendance,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Check-out failed';
    return sendError(res, 'VALIDATION_ERROR', message, 400);
  }
}

export async function getAttendanceStatusHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> {
  const { driverId } = req.params;
  const access = await canActOnDriver(req, driverId);
  if (!access.driver) {
    return sendNotFound(res, 'Driver');
  }
  if (!access.allowed) {
    return sendError(res, 'UNAUTHORIZED', 'Access denied', 403);
  }

  const status = await getDriverAttendanceStatus(driverId);
  return sendSuccess(res, status);
}
