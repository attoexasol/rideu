import { Request, Response } from 'express';
import { sendSuccess, sendError } from '../utils/response';
import { driverUtils } from '../db/utils';
import {
  initiateVehicleExchange,
  confirmVehicleExchange,
  cancelVehicleExchange,
  getCurrentVehicleExchange,
  mapExchangeResponse,
  VehicleExchangeError,
} from '../services/vehicleExchange.service';

function handleExchangeError(res: Response, err: unknown) {
  if (err instanceof VehicleExchangeError) {
    const status = err.code === 'EXCHANGE_ALREADY_COMPLETED' ? 200 : err.statusCode;
    if (err.code === 'EXCHANGE_ALREADY_COMPLETED') {
      return sendSuccess(res, { message: err.message, code: err.code });
    }
    return sendError(res, err.code, err.message, status);
  }
  throw err;
}

export async function initiateExchangeHandler(req: Request, res: Response) {
  const user = (req as Request & { user?: { auth0Id?: string } }).user;
  const driver = await driverUtils.findByAuth0Id(user?.auth0Id ?? '');
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);

  const idempotencyKey = req.header('Idempotency-Key');
  if (!idempotencyKey) {
    return sendError(res, 'VALIDATION_ERROR', 'Idempotency-Key header is required', 400);
  }

  try {
    const result = await initiateVehicleExchange({
      initiatorDriverId: driver.id,
      scannedVehicleQrToken: req.body.scannedVehicleQrToken,
      idempotencyKey,
      location: req.body.location,
    });
    return sendSuccess(
      res,
      {
        ...mapExchangeResponse(result.exchange, result.role),
        idempotent: result.idempotent,
      },
      result.idempotent ? 200 : 201
    );
  } catch (err) {
    return handleExchangeError(res, err);
  }
}

export async function confirmExchangeHandler(req: Request, res: Response) {
  const user = (req as Request & { user?: { auth0Id?: string } }).user;
  const driver = await driverUtils.findByAuth0Id(user?.auth0Id ?? '');
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);

  try {
    const result = await confirmVehicleExchange({
      exchangeId: req.params.exchangeId,
      partnerDriverId: driver.id,
      scannedVehicleQrToken: req.body.scannedVehicleQrToken,
      location: req.body.location,
    });
    return sendSuccess(res, {
      ...mapExchangeResponse(result.exchange, 'partner'),
      idempotent: result.idempotent,
      assignments: result.assignments
        ? {
            assignmentId: result.assignments.partner.id,
            vehicleId: result.assignments.partner.vehicleId,
          }
        : null,
    });
  } catch (err) {
    return handleExchangeError(res, err);
  }
}

export async function cancelExchangeHandler(req: Request, res: Response) {
  const user = (req as Request & { user?: { auth0Id?: string } }).user;
  const driver = await driverUtils.findByAuth0Id(user?.auth0Id ?? '');
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);

  try {
    const result = await cancelVehicleExchange(
      req.params.exchangeId,
      driver.id,
      req.body.reason
    );
    return sendSuccess(res, {
      id: result.exchange.id,
      status: result.exchange.status,
      idempotent: result.idempotent,
    });
  } catch (err) {
    return handleExchangeError(res, err);
  }
}

export async function currentExchangeHandler(req: Request, res: Response) {
  const user = (req as Request & { user?: { auth0Id?: string } }).user;
  const driver = await driverUtils.findByAuth0Id(user?.auth0Id ?? '');
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);

  const data = await getCurrentVehicleExchange(driver.id);
  return sendSuccess(res, data);
}
