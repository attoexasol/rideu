import jwt from 'jsonwebtoken';
import { auth0Management, PasswordResetError } from './auth0Management';
import { verifyAuth0Token, isAuth0Configured } from '../utils/jwt-verifier';
import {
  findCustomerByAuth0Id,
  findCustomerByEmail,
  insertCustomer,
  updateCustomerSession,
  clearCustomerSession,
} from '../repositories/customer.repository';
import { sessionUtils } from '../db/utils';
import { AccountDeactivatedError, assertAccountActive } from './accountStatus.service';
import { logger } from '../middleware/logger';

const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

export { PasswordResetError, AccountDeactivatedError };

export async function registerPassenger(input: { email: string; password: string; name: string }) {
  const email = input.email.trim().toLowerCase();

  const existing = await findCustomerByEmail(email);
  if (existing) {
    throw new Error('A customer with this email already exists');
  }

  if (!auth0Management.isConfigured()) {
    throw new Error('Auth0 Management API is not configured');
  }

  const auth0User = await auth0Management.createCustomer({
    email,
    password: input.password,
    name: input.name,
  });

  const customer = await insertCustomer({
    auth0Id: auth0User.user_id,
    email,
    name: input.name,
    status: 'active',
    emailVerifiedAt: new Date(),
  });

  return customer;
}

export async function loginPassenger(input: {
  auth0Token: string;
  deviceId?: string;
  deviceInfo?: string;
}) {
  let decoded: any;
  try {
    if (isAuth0Configured()) {
      decoded = await verifyAuth0Token(input.auth0Token);
    } else {
      decoded = jwt.decode(input.auth0Token) as any;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Token verification failed';
    console.error('Passenger login token verification failed:', message);
    throw new Error(
      'Invalid Auth0 token. Ensure the app requests audience https://api.drivewize.com and sends the access_token (not id_token).'
    );
  }

  if (!decoded?.sub) {
    throw new Error('Invalid Auth0 token');
  }

  const customer = await findCustomerByAuth0Id(decoded.sub);
  if (!customer) {
    const role =
      decoded['https://drivewize.com/role'] ||
      decoded['https://rydu.com/role'] ||
      decoded.role ||
      decoded.app_metadata?.role;

    if (role && role !== 'customer') {
      throw new Error('Invalid account type for passenger login');
    }
    throw new Error('Customer not found in database');
  }

  assertAccountActive(customer.status);

  const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  const previousDeviceId = customer.activeDeviceId;
  const token = jwt.sign(
    {
      userId: customer.id,
      auth0Id: customer.auth0Id,
      name: customer.name,
      email: customer.email,
      role: 'customer',
      userType: 'customer',
      sessionId,
      permissions: [],
    },
    JWT_SECRET as jwt.Secret,
    { expiresIn: JWT_EXPIRES_IN, algorithm: 'HS256' } as jwt.SignOptions
  );

  try {
    const { onPassengerSessionReplaced } = await import('./passengerPushToken.service');
    await onPassengerSessionReplaced({
      customerId: customer.id,
      newDeviceId: input.deviceId,
      newSessionId: sessionId,
      previousDeviceId,
    });
  } catch (error) {
    logger.warn({
      event: 'passenger.push.failed',
      customerId: customer.id,
      pushAttempted: false,
      pushSent: false,
      pushFailureCode: 'ISOLATED_EXCEPTION',
      message: error instanceof Error ? error.message : 'unknown',
    });
  }

  await updateCustomerSession(customer.id, {
    activeSessionId: sessionId,
    activeDeviceId: input.deviceId,
    activeDeviceInfo: input.deviceInfo,
  });

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await sessionUtils.create({
    userId: customer.id,
    userType: 'customer',
    token,
    expiresAt,
  });

  return {
    token,
    sessionId,
    user: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      role: 'customer',
    },
  };
}

export async function logoutPassenger(userId: string, token?: string) {
  if (token) {
    await sessionUtils.deleteByToken(token);
  }
  await clearCustomerSession(userId);
  try {
    const { invalidatePassengerPushTargets } = await import('./passengerPushToken.service');
    await invalidatePassengerPushTargets(userId);
  } catch (error) {
    logger.warn({
      event: 'passenger.push.failed',
      customerId: userId,
      pushAttempted: false,
      pushSent: false,
      pushFailureCode: 'ISOLATED_EXCEPTION',
      message: error instanceof Error ? error.message : 'unknown',
    });
  }
}

export async function requestPasswordReset(email: string): Promise<{ message: string }> {
  const normalizedEmail = email.trim().toLowerCase();
  const customer = await findCustomerByEmail(normalizedEmail);

  if (!customer) {
    console.log(`[forgot-password] No customer in database for: ${normalizedEmail}`);
    throw new PasswordResetError('No account found with this email address', 'NOT_FOUND', 404);
  }

  if (!auth0Management.isPasswordResetConfigured()) {
    throw new PasswordResetError(
      'Password reset is not configured. Set AUTH0_DOMAIN and AUTH0_CLIENT_ID.',
      'CONFIG_ERROR',
      503
    );
  }

  const result = await auth0Management.sendPasswordResetEmail(normalizedEmail);
  console.log(`[forgot-password] Reset email requested for: ${normalizedEmail}`);

  return {
    message:
      result.detail ||
      'Password reset instructions have been sent to your email. Check inbox and spam folder.',
  };
}
