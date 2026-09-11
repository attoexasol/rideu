import { Request, Response } from 'express';
import { PaymentError } from '../services/payment.errors';
import {
  getMarketFaresForAdmin,
  listMarketsForAdmin,
  upsertMarketFaresForAdmin,
} from '../services/rideMarket.service';
import { sendError, sendSuccess } from '../utils/response';

function handleMarketError(res: Response, error: unknown) {
  if (error instanceof PaymentError) {
    return sendError(res, error.code, error.message, error.statusCode);
  }
  throw error;
}

export async function listAdminMarketsHandler(_req: Request, res: Response) {
  return sendSuccess(res, await listMarketsForAdmin());
}

export async function getAdminMarketFaresHandler(req: Request, res: Response) {
  try {
    return sendSuccess(res, await getMarketFaresForAdmin(req.params.code));
  } catch (error) {
    return handleMarketError(res, error);
  }
}

export async function putAdminMarketFaresHandler(req: Request, res: Response) {
  try {
    return sendSuccess(res, await upsertMarketFaresForAdmin(req.params.code, req.body.fares));
  } catch (error) {
    return handleMarketError(res, error);
  }
}
