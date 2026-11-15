import { Request, Response } from 'express';
import { sendError, sendSuccess } from '../utils/response';
import { DriverRegistrationError, registerDriver } from '../services/driverRegistration.service';

export async function registerDriverHandler(req: Request, res: Response) {
  try {
    const driver = await registerDriver(req.body);
    return sendSuccess(res, driver, 201);
  } catch (error) {
    if (error instanceof DriverRegistrationError) {
      return sendError(res, error.code, error.message, error.statusCode);
    }
    return sendError(res, 'REGISTRATION_FAILED', 'Unable to create the driver account', 500);
  }
}
