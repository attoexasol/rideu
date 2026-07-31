import { Request, Response } from 'express';
import { sendSuccess, sendError } from '../utils/response';
import {
  listExchanges,
  findExchangeById,
  listExchangeEvents,
} from '../repositories/vehicleExchange.repository';
import { cancelVehicleExchange, VehicleExchangeError } from '../services/vehicleExchange.service';

export async function adminListExchangesHandler(req: Request, res: Response) {
  const status = req.query.status as string | undefined;
  const fleetId = req.query.fleetId as string | undefined;
  const rows = await listExchanges({ status, fleetId });
  return sendSuccess(res, rows);
}

export async function adminGetExchangeHandler(req: Request, res: Response) {
  const row = await findExchangeById(req.params.id);
  if (!row) return sendError(res, 'NOT_FOUND', 'Exchange not found', 404);
  return sendSuccess(res, row);
}

export async function adminListExchangeEventsHandler(req: Request, res: Response) {
  const row = await findExchangeById(req.params.id);
  if (!row) return sendError(res, 'NOT_FOUND', 'Exchange not found', 404);
  const events = await listExchangeEvents(req.params.id);
  return sendSuccess(res, events);
}

export async function adminCancelExchangeHandler(req: Request, res: Response) {
  const exchange = await findExchangeById(req.params.id);
  if (!exchange) return sendError(res, 'NOT_FOUND', 'Exchange not found', 404);

  try {
    const result = await cancelVehicleExchange(
      req.params.id,
      exchange.initiatorDriverId,
      req.body.reason ?? 'admin_cancelled'
    );
    return sendSuccess(res, result);
  } catch (err) {
    if (err instanceof VehicleExchangeError) {
      return sendError(res, err.code, err.message, err.statusCode);
    }
    throw err;
  }
}
