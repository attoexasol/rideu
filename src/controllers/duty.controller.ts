import { Request, Response } from 'express';
import { sendSuccess, sendError } from '../utils/response';
import {
  startDuty,
  endDuty,
  getCurrentDuty,
  getCurrentVehicleQrForDriver,
  DutyError,
} from '../services/duty.service';
import { driverUtils } from '../db/utils';

function handleDutyError(res: Response, err: unknown) {
  if (err instanceof DutyError) {
    return sendError(res, err.code, err.message, err.statusCode, err.details);
  }
  throw err;
}

export async function dutyStartHandler(req: Request, res: Response) {
  const user = (req as Request & { user?: { userId?: string; auth0Id?: string } }).user;
  const driver = await driverUtils.findByAuth0Id(user?.auth0Id ?? '');
  if (!driver) {
    return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  }

  try {
    const data = await startDuty({
      driverId: driver.id,
      vehicleQrToken: req.body.vehicleQrToken,
      location: req.body.location,
      deviceId: req.body.deviceId,
    });
    return sendSuccess(res, data, data.idempotent ? 200 : 201);
  } catch (err) {
    return handleDutyError(res, err);
  }
}

export async function dutyEndHandler(req: Request, res: Response) {
  const user = (req as Request & { user?: { auth0Id?: string } }).user;
  const driver = await driverUtils.findByAuth0Id(user?.auth0Id ?? '');
  if (!driver) {
    return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  }

  try {
    const data = await endDuty({
      driverId: driver.id,
      reason: req.body.reason,
      location: req.body.location,
    });
    return sendSuccess(res, data);
  } catch (err) {
    return handleDutyError(res, err);
  }
}

export async function dutyCurrentHandler(req: Request, res: Response) {
  const user = (req as Request & { user?: { auth0Id?: string } }).user;
  const driver = await driverUtils.findByAuth0Id(user?.auth0Id ?? '');
  if (!driver) {
    return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  }

  const data = await getCurrentDuty(driver.id);
  return sendSuccess(res, data);
}

export async function dutyCurrentVehicleQrHandler(req: Request, res: Response) {
  const user = (req as Request & { user?: { auth0Id?: string } }).user;
  const driver = await driverUtils.findByAuth0Id(user?.auth0Id ?? '');
  if (!driver) {
    return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  }

  try {
    const data = await getCurrentVehicleQrForDriver(driver.id);
    return sendSuccess(res, data);
  } catch (err) {
    return handleDutyError(res, err);
  }
}
