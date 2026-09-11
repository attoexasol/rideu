import { Request, Response } from 'express';
import { driverUtils } from '../db/utils';
import {
  getDriverPaymentDetail,
  getDriverPaymentSummary,
  listDriverPayments,
} from '../services/driverPaymentHistory.service';
import { calculatePagination, sendError, sendSuccess } from '../utils/response';

async function resolveSelfDriver(req: Request) {
  const user = (req as any).user;
  return driverUtils.findByAuth0Id(user?.auth0Id ?? '');
}

export async function listDriverPaymentsHandler(req: Request, res: Response) {
  const driver = await resolveSelfDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);

  const page = Number((req.query as { page?: number }).page) || 1;
  const limit = Number((req.query as { limit?: number }).limit) || 20;
  const result = await listDriverPayments(driver.id, page, limit);

  return sendSuccess(res, result.items, 200, {
    pagination: calculatePagination(result.total, page, limit),
  });
}

export async function getDriverPaymentSummaryHandler(req: Request, res: Response) {
  const driver = await resolveSelfDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);

  const data = await getDriverPaymentSummary(driver.id);
  return sendSuccess(res, data);
}

export async function getDriverPaymentDetailHandler(req: Request, res: Response) {
  const driver = await resolveSelfDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);

  const detail = await getDriverPaymentDetail(driver.id, req.params.paymentId);
  if (!detail) {
    return sendError(res, 'PAYMENT_NOT_FOUND', 'Payment not found or access denied', 404);
  }
  return sendSuccess(res, detail);
}
