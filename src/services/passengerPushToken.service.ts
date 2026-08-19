import type { Customer } from '../db/schema/customers';
import type { PassengerPushToken } from '../db/schema/passenger_push_tokens';
import {
  deletePassengerPushTokenById,
  deletePassengerPushTokensForCustomer,
  deletePassengerPushTokensForCustomerExceptDevice,
  findCustomerSessionForPush,
  findEnabledPushTokenForPassengerDevice,
  updatePassengerPushTokenSessionForDevice,
  upsertPassengerPushToken,
} from '../repositories/passengerPushToken.repository';
import { logger } from '../middleware/logger';

export class PassengerPushTokenError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = 'PassengerPushTokenError';
  }
}

function assertActivePassengerTarget(customer: Customer): {
  deviceId: string;
  sessionId: string;
} {
  const deviceId = customer.activeDeviceId?.trim() || '';
  const sessionId = customer.activeSessionId?.trim() || '';
  if (!deviceId || !sessionId) {
    throw new PassengerPushTokenError(
      'DEVICE_REQUIRED',
      'Active passenger device/session is required to register a push token',
      400
    );
  }
  return { deviceId, sessionId };
}

export async function registerPassengerPushToken(input: {
  customer: Customer;
  fcmToken: string;
  requestDeviceId?: string | null;
  bodyDeviceId?: string | null;
  requestSessionId?: string | null;
}): Promise<{ deviceId: string; registeredAt: string }> {
  const { deviceId, sessionId } = assertActivePassengerTarget(input.customer);

  const headerDeviceId = input.requestDeviceId?.trim() || '';
  if (!headerDeviceId) {
    throw new PassengerPushTokenError(
      'DEVICE_REQUIRED',
      'X-Device-ID is required to register a push token',
      400
    );
  }
  if (headerDeviceId !== deviceId) {
    throw new PassengerPushTokenError(
      'DEVICE_MISMATCH',
      'X-Device-ID does not match the active passenger device',
      400
    );
  }

  if (input.bodyDeviceId && input.bodyDeviceId !== deviceId) {
    throw new PassengerPushTokenError(
      'DEVICE_MISMATCH',
      'deviceId does not match the active passenger device',
      400
    );
  }

  if (!input.requestSessionId || input.requestSessionId !== sessionId) {
    throw new PassengerPushTokenError(
      'SESSION_INVALID',
      'Your session has been ended. You have been logged in from another device.',
      401
    );
  }

  const token = input.fcmToken.trim();
  if (!token) {
    throw new PassengerPushTokenError('VALIDATION_ERROR', 'token is required', 400);
  }

  const row = await upsertPassengerPushToken({
    customerId: input.customer.id,
    deviceId,
    sessionId,
    fcmToken: token,
  });

  logger.info({
    event: 'passenger.push.registered',
    customerId: input.customer.id,
    deviceId,
    pushAttempted: false,
    pushSent: false,
  });

  return {
    deviceId: row.deviceId,
    registeredAt: row.lastRegisteredAt.toISOString(),
  };
}

export async function unregisterPassengerPushToken(
  customer: Customer
): Promise<{ removed: boolean }> {
  const deviceId = customer.activeDeviceId?.trim();
  if (!deviceId) {
    const removed = await deletePassengerPushTokensForCustomer(customer.id);
    return { removed: removed > 0 };
  }

  const existing = await findEnabledPushTokenForPassengerDevice(customer.id, deviceId);
  if (existing) {
    await deletePassengerPushTokenById(existing.id);
  }
  await deletePassengerPushTokensForCustomerExceptDevice(customer.id, deviceId);
  return { removed: true };
}

export async function invalidatePassengerPushTargets(customerId: string): Promise<void> {
  await deletePassengerPushTokensForCustomer(customerId);
  logger.info({
    event: 'passenger.push.invalidated',
    customerId,
    pushAttempted: false,
    pushSent: false,
  });
}

export async function onPassengerSessionReplaced(input: {
  customerId: string;
  newDeviceId: string | null | undefined;
  newSessionId: string;
  previousDeviceId?: string | null;
}): Promise<void> {
  const newDeviceId = input.newDeviceId?.trim() || '';
  if (!newDeviceId || (input.previousDeviceId && input.previousDeviceId !== newDeviceId)) {
    await deletePassengerPushTokensForCustomer(input.customerId);
    logger.info({
      event: 'passenger.push.invalidated',
      customerId: input.customerId,
      deviceId: newDeviceId || null,
      pushAttempted: false,
      pushSent: false,
      pushFailureCode: newDeviceId ? 'DEVICE_CHANGED' : 'NO_ACTIVE_DEVICE',
    });
    return;
  }

  await deletePassengerPushTokensForCustomerExceptDevice(input.customerId, newDeviceId);
  await updatePassengerPushTokenSessionForDevice(
    input.customerId,
    newDeviceId,
    input.newSessionId
  );
}

export async function findEnabledPassengerPushTokenForActiveDevice(customerId: string): Promise<{
  deviceId: string;
  sessionId: string;
  token: PassengerPushToken;
} | null> {
  const customerRow = await findCustomerSessionForPush(customerId);
  if (!customerRow?.activeDeviceId || !customerRow.activeSessionId) {
    return null;
  }

  const token = await findEnabledPushTokenForPassengerDevice(
    customerId,
    customerRow.activeDeviceId
  );
  if (
    !token ||
    !token.enabled ||
    token.sessionId !== customerRow.activeSessionId ||
    token.deviceId !== customerRow.activeDeviceId
  ) {
    return null;
  }

  return {
    deviceId: customerRow.activeDeviceId,
    sessionId: customerRow.activeSessionId,
    token,
  };
}

export async function cleanupInvalidPassengerPushToken(tokenId: string): Promise<void> {
  await deletePassengerPushTokenById(tokenId);
}
