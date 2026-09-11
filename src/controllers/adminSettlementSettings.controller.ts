import { Request, Response } from 'express';
import { SettlementRulesNotConfiguredError, SettlementSettingsError } from '../services/payment.errors';
import {
  getSettlementSettingsForAdmin,
  updateActiveSettlementSettings,
} from '../services/settlementSettings.service';
import { sendError, sendSuccess } from '../utils/response';

export async function getAdminSettlementSettingsHandler(_req: Request, res: Response) {
  try {
    const data = await getSettlementSettingsForAdmin();
    return sendSuccess(res, data);
  } catch (error) {
    if (error instanceof SettlementRulesNotConfiguredError) {
      return sendError(res, error.code, error.message, 404);
    }
    throw error;
  }
}

export async function patchAdminSettlementSettingsHandler(req: Request, res: Response) {
  try {
    const body = req.body as {
      driverPercentage: string | number;
      companyPercentage: string | number;
    };
    const data = await updateActiveSettlementSettings(body);
    return sendSuccess(res, data);
  } catch (error) {
    if (error instanceof SettlementSettingsError) {
      return sendError(res, error.code, error.message, error.statusCode);
    }
    throw error;
  }
}
