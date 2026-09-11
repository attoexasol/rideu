import { Request, Response } from 'express';
import {
  AirportConfigError,
  createAirportForAdmin,
  getAirportForAdmin,
  listAirportsForAdmin,
  updateAirportForAdmin,
} from '../services/airportAdmin.service';
import { sendError, sendSuccess } from '../utils/response';

function handleAirportError(res: Response, error: unknown) {
  if (error instanceof AirportConfigError) {
    return sendError(res, error.code, error.message, error.statusCode);
  }
  throw error;
}

export async function listAdminAirportsHandler(_req: Request, res: Response) {
  const data = await listAirportsForAdmin();
  return sendSuccess(res, data);
}

export async function getAdminAirportHandler(req: Request, res: Response) {
  try {
    const data = await getAirportForAdmin(req.params.id);
    return sendSuccess(res, data);
  } catch (error) {
    return handleAirportError(res, error);
  }
}

export async function createAdminAirportHandler(req: Request, res: Response) {
  try {
    const data = await createAirportForAdmin(req.body);
    return sendSuccess(res, data, 201);
  } catch (error) {
    return handleAirportError(res, error);
  }
}

export async function patchAdminAirportHandler(req: Request, res: Response) {
  try {
    const data = await updateAirportForAdmin(req.params.id, req.body);
    return sendSuccess(res, data);
  } catch (error) {
    return handleAirportError(res, error);
  }
}
