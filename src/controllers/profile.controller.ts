import { Request, Response } from 'express';
import { sendSuccess, sendError, calculatePagination } from '../utils/response';
import { driverUtils } from '../db/utils';
import { findCustomerById } from '../repositories/customer.repository';
import {
  AvatarStorageError,
  ProfileError,
  deactivateDriverAccount,
  deactivatePassengerAccount,
  getAdminPassenger,
  getDriverProfile,
  getPassengerProfile,
  listAdminPassengers,
  removeDriverAvatar,
  removePassengerAvatar,
  updateDriverProfile,
  updatePassengerProfile,
  uploadDriverAvatar,
  uploadPassengerAvatar,
} from '../services/profile.service';

function handleProfileError(res: Response, error: unknown): Response | void {
  if (error instanceof ProfileError || error instanceof AvatarStorageError) {
    return sendError(res, error.code, error.message, error.statusCode);
  }
  throw error;
}

async function resolveSelfDriver(req: Request) {
  const user = (req as any).user;
  const driver = await driverUtils.findByAuth0Id(user?.auth0Id ?? '');
  return driver;
}

function resolveSelfCustomerId(req: Request): string | null {
  const user = (req as any).user;
  return typeof user?.userId === 'string' ? user.userId : null;
}

export async function getDriverProfileHandler(req: Request, res: Response) {
  const driver = await resolveSelfDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  try {
    const data = await getDriverProfile(driver.id);
    return sendSuccess(res, data);
  } catch (error) {
    return handleProfileError(res, error);
  }
}

export async function patchDriverProfileHandler(req: Request, res: Response) {
  const driver = await resolveSelfDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  try {
    const data = await updateDriverProfile(driver.id, req.body);
    return sendSuccess(res, data);
  } catch (error) {
    return handleProfileError(res, error);
  }
}

export async function uploadDriverAvatarHandler(req: Request, res: Response) {
  const driver = await resolveSelfDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  if (!req.file?.buffer) {
    return sendError(res, 'VALIDATION_ERROR', 'avatar file is required', 400);
  }
  try {
    const data = await uploadDriverAvatar(driver.id, req.file.buffer, req.file.mimetype);
    return sendSuccess(res, data);
  } catch (error) {
    return handleProfileError(res, error);
  }
}

export async function deleteDriverAvatarHandler(req: Request, res: Response) {
  const driver = await resolveSelfDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  try {
    const data = await removeDriverAvatar(driver.id);
    return sendSuccess(res, data);
  } catch (error) {
    return handleProfileError(res, error);
  }
}

export async function deactivateDriverHandler(req: Request, res: Response) {
  const driver = await resolveSelfDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  try {
    const data = await deactivateDriverAccount(driver.id);
    return sendSuccess(res, data);
  } catch (error) {
    return handleProfileError(res, error);
  }
}

export async function getPassengerProfileHandler(req: Request, res: Response) {
  const customerId = resolveSelfCustomerId(req);
  if (!customerId) return sendError(res, 'NOT_FOUND', 'Customer not found', 404);
  const existing = await findCustomerById(customerId);
  if (!existing) return sendError(res, 'NOT_FOUND', 'Customer not found', 404);
  try {
    const data = await getPassengerProfile(customerId);
    return sendSuccess(res, data);
  } catch (error) {
    return handleProfileError(res, error);
  }
}

export async function patchPassengerProfileHandler(req: Request, res: Response) {
  const customerId = resolveSelfCustomerId(req);
  if (!customerId) return sendError(res, 'NOT_FOUND', 'Customer not found', 404);
  try {
    const data = await updatePassengerProfile(customerId, req.body);
    return sendSuccess(res, data);
  } catch (error) {
    return handleProfileError(res, error);
  }
}

export async function uploadPassengerAvatarHandler(req: Request, res: Response) {
  const customerId = resolveSelfCustomerId(req);
  if (!customerId) return sendError(res, 'NOT_FOUND', 'Customer not found', 404);
  if (!req.file?.buffer) {
    return sendError(res, 'VALIDATION_ERROR', 'avatar file is required', 400);
  }
  try {
    const data = await uploadPassengerAvatar(customerId, req.file.buffer, req.file.mimetype);
    return sendSuccess(res, data);
  } catch (error) {
    return handleProfileError(res, error);
  }
}

export async function deletePassengerAvatarHandler(req: Request, res: Response) {
  const customerId = resolveSelfCustomerId(req);
  if (!customerId) return sendError(res, 'NOT_FOUND', 'Customer not found', 404);
  try {
    const data = await removePassengerAvatar(customerId);
    return sendSuccess(res, data);
  } catch (error) {
    return handleProfileError(res, error);
  }
}

export async function deactivatePassengerHandler(req: Request, res: Response) {
  const customerId = resolveSelfCustomerId(req);
  if (!customerId) return sendError(res, 'NOT_FOUND', 'Customer not found', 404);
  try {
    const data = await deactivatePassengerAccount(customerId);
    return sendSuccess(res, data);
  } catch (error) {
    return handleProfileError(res, error);
  }
}

export async function listAdminPassengersHandler(req: Request, res: Response) {
  const query = req.query as unknown as { page: number; limit: number; search?: string };
  const page = query.page;
  const limit = query.limit;
  const search = query.search;
  const { passengers, total } = await listAdminPassengers({ page, limit, search });
  return sendSuccess(res, passengers, 200, { pagination: calculatePagination(total, page, limit) });
}

export async function getAdminPassengerHandler(req: Request, res: Response) {
  try {
    const data = await getAdminPassenger(req.params.id);
    return sendSuccess(res, data);
  } catch (error) {
    return handleProfileError(res, error);
  }
}
