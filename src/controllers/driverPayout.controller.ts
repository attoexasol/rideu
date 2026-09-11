import { Request, Response } from 'express';
import { driverUtils } from '../db/utils';
import { PaymentError } from '../services/payment.errors';
import {
  createDriverOnboardingLink,
  getDriverPayoutStatus,
} from '../services/stripeConnect.service';
import { sendError, sendSuccess } from '../utils/response';

async function resolveSelfDriver(req: Request) {
  const user = (req as any).user;
  return driverUtils.findByAuth0Id(user?.auth0Id ?? '');
}

function handlePayoutError(res: Response, error: unknown): Response | void {
  if (error instanceof PaymentError) {
    return sendError(res, error.code, error.message, error.statusCode);
  }
  throw error;
}

export async function createDriverOnboardingLinkHandler(req: Request, res: Response) {
  const driver = await resolveSelfDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  try {
    const data = await createDriverOnboardingLink(driver.id);
    return sendSuccess(res, data);
  } catch (error) {
    return handlePayoutError(res, error);
  }
}

export async function getDriverPayoutStatusHandler(req: Request, res: Response) {
  const driver = await resolveSelfDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  try {
    const data = await getDriverPayoutStatus(driver.id);
    return sendSuccess(res, data);
  } catch (error) {
    return handlePayoutError(res, error);
  }
}
