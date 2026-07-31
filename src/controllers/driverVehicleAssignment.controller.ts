import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import {
  getActiveAssignmentForDriver,
  scanAndAssignVehicle,
} from '../services/driverVehicleAssignment.service';
import { canActOnDriver } from '../utils/driverAccess';
import { sendError, sendNotFound, sendSuccess } from '../utils/response';

export async function scanVehicleHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> {
  const { driverId, vehicleQrCode } = req.body;

  const access = await canActOnDriver(req, driverId);
  if (!access.driver) {
    return sendNotFound(res, 'Driver');
  }
  if (!access.allowed) {
    return sendError(res, 'UNAUTHORIZED', 'You cannot scan a vehicle for this driver', 403);
  }

  try {
    const result = await scanAndAssignVehicle(driverId, vehicleQrCode);
    return sendSuccess(res, {
      message: 'Vehicle verified successfully',
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to scan vehicle';
    const status = message.includes('not found') ? 404 : 400;
    return sendError(res, status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', message, status);
  }
}

export async function getActiveAssignmentHandler(
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

  const vehicle = await getActiveAssignmentForDriver(driverId);
  return sendSuccess(res, vehicle ?? { message: 'No vehicle information found' });
}
