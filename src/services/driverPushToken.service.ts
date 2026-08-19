import type { Driver } from '../db/schema/drivers';
import {
  deletePushTokenById,
  deletePushTokensForDriver,
  deletePushTokensForDriverExceptDevice,
  findEnabledPushTokenForDriverDevice,
  updatePushTokenSessionForDevice,
  upsertDriverPushToken,
} from '../repositories/driverPushToken.repository';
import { logger } from '../middleware/logger';

export class DriverPushTokenError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = 'DriverPushTokenError';
  }
}

function assertActiveDriverTarget(driver: Driver): {
  deviceId: string;
  sessionId: string;
} {
  const deviceId = driver.activeDeviceId?.trim() || '';
  const sessionId = driver.activeSessionId?.trim() || '';
  if (!deviceId || !sessionId) {
    throw new DriverPushTokenError(
      'DEVICE_REQUIRED',
      'Active driver device/session is required to register a push token',
      400
    );
  }
  return { deviceId, sessionId };
}

export async function registerDriverPushToken(input: {
  driver: Driver;
  fcmToken: string;
  requestDeviceId?: string | null;
  bodyDeviceId?: string | null;
  requestSessionId?: string | null;
}): Promise<{ deviceId: string; registeredAt: string }> {
  const { deviceId, sessionId } = assertActiveDriverTarget(input.driver);

  if (input.requestSessionId && input.requestSessionId !== sessionId) {
    throw new DriverPushTokenError(
      'SESSION_INVALID',
      'Your session has been ended. You have been logged in from another device.',
      401
    );
  }

  if (input.requestDeviceId && input.requestDeviceId !== deviceId) {
    throw new DriverPushTokenError(
      'DEVICE_MISMATCH',
      'X-Device-ID does not match the active driver device',
      400
    );
  }

  if (input.bodyDeviceId && input.bodyDeviceId !== deviceId) {
    throw new DriverPushTokenError(
      'DEVICE_MISMATCH',
      'deviceId does not match the active driver device',
      400
    );
  }

  const token = input.fcmToken.trim();
  if (!token) {
    throw new DriverPushTokenError('VALIDATION_ERROR', 'token is required', 400);
  }

  const row = await upsertDriverPushToken({
    driverId: input.driver.id,
    deviceId,
    sessionId,
    fcmToken: token,
  });

  logger.info({
    event: 'driver.push.token_registered',
    driverId: input.driver.id,
    deviceId,
    pushAttempted: false,
    pushSent: false,
  });

  return {
    deviceId: row.deviceId,
    registeredAt: row.lastRegisteredAt.toISOString(),
  };
}

export async function unregisterDriverPushToken(driver: Driver): Promise<{ removed: boolean }> {
  const deviceId = driver.activeDeviceId?.trim();
  if (!deviceId) {
    const removed = await deletePushTokensForDriver(driver.id);
    return { removed: removed > 0 };
  }

  const existing = await findEnabledPushTokenForDriverDevice(driver.id, deviceId);
  if (existing) {
    await deletePushTokenById(existing.id);
  }
  await deletePushTokensForDriverExceptDevice(driver.id, deviceId);
  return { removed: true };
}

export async function invalidateDriverPushTargets(driverId: string): Promise<void> {
  await deletePushTokensForDriver(driverId);
  logger.info({
    event: 'driver.push.targets_invalidated',
    driverId,
    pushAttempted: false,
    pushSent: false,
  });
}

export async function onDriverSessionReplaced(input: {
  driverId: string;
  newDeviceId: string | null | undefined;
  newSessionId: string;
  previousDeviceId?: string | null;
}): Promise<void> {
  const newDeviceId = input.newDeviceId?.trim() || '';
  if (!newDeviceId || (input.previousDeviceId && input.previousDeviceId !== newDeviceId)) {
    await deletePushTokensForDriver(input.driverId);
    return;
  }

  await deletePushTokensForDriverExceptDevice(input.driverId, newDeviceId);
  await updatePushTokenSessionForDevice(input.driverId, newDeviceId, input.newSessionId);
}

export async function cleanupInvalidPushToken(tokenId: string): Promise<void> {
  await deletePushTokenById(tokenId);
}
