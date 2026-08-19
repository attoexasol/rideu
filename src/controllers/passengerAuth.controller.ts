import { Request, Response } from 'express';
import { sendSuccess, sendError } from '../utils/response';
import {
  registerPassenger,
  loginPassenger,
  logoutPassenger,
  requestPasswordReset,
  PasswordResetError,
  AccountDeactivatedError,
} from '../services/passengerAuth.service';
import { findCustomerById } from '../repositories/customer.repository';

export async function registerHandler(req: Request, res: Response) {
  try {
    const customer = await registerPassenger(req.body);
    return sendSuccess(res, { id: customer.id, name: customer.name, email: customer.email }, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Registration failed';
    const code = msg.includes('already exists') ? 409 : 400;
    return sendError(res, 'REGISTRATION_FAILED', msg, code);
  }
}

export async function loginHandler(req: Request, res: Response) {
  try {
    const result = await loginPassenger(req.body);
    return sendSuccess(res, result);
  } catch (e) {
    if (e instanceof AccountDeactivatedError) {
      return sendError(res, e.code, e.message, e.statusCode);
    }
    return sendError(res, 'AUTH_FAILED', e instanceof Error ? e.message : 'Login failed', 401);
  }
}

export async function logoutHandler(req: Request, res: Response) {
  const user = (req as any).user;
  const token = req.headers.authorization?.split(' ')[1];
  await logoutPassenger(user.userId, token);
  return sendSuccess(res, { message: 'Logged out' });
}

export async function meHandler(req: Request, res: Response) {
  const user = (req as any).user;
  const customer = await findCustomerById(user.userId);
  if (!customer) return sendError(res, 'NOT_FOUND', 'Customer not found', 404);
  return sendSuccess(res, {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    role: 'customer',
  });
}

export async function forgotPasswordHandler(req: Request, res: Response) {
  try {
    const result = await requestPasswordReset(req.body.email);
    return sendSuccess(res, result);
  } catch (e) {
    if (e instanceof PasswordResetError) {
      return sendError(res, e.errorCode, e.message, e.statusCode);
    }
    return sendError(res, 'RESET_FAILED', e instanceof Error ? e.message : 'Reset failed', 500);
  }
}
