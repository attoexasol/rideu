import { logger } from '../middleware/logger';
import {
  FCM_TRANSIENT_MAX_ATTEMPTS,
  FCM_TRANSIENT_RETRY_DELAY_MS,
  isFcmEnabled,
} from '../config/fcm';
import { isFcmReady, sendFcmMessage } from './fcmAdmin.service';
import { findEnabledPushTokenForDriverDevice, findDriverSessionForPush } from '../repositories/driverPushToken.repository';
import { cleanupInvalidPushToken } from './driverPushToken.service';
import {
  buildDriverOfferFcmMessage,
  classifyFcmError,
  fcmTokenSuffix,
  getFcmErrorCode,
  remainingOfferTtlSeconds,
  shouldSendOfferPush,
} from './driverOfferPush.payload';

export type SendDriverOfferPushInput = {
  driverId: string;
  bookingId: string;
  offerId: string;
  expiresAt: Date;
};

export type SendDriverOfferPushResult = {
  pushAttempted: boolean;
  pushSent: boolean;
  pushFailureCode: string | null;
  remainingTtlSeconds: number;
  deviceId: string | null;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logPush(
  input: SendDriverOfferPushInput,
  result: SendDriverOfferPushResult
): void {
  logger.info({
    event: 'driver.push.offer',
    driverId: input.driverId,
    bookingId: input.bookingId,
    offerId: input.offerId,
    deviceId: result.deviceId,
    pushAttempted: result.pushAttempted,
    pushSent: result.pushSent,
    pushFailureCode: result.pushFailureCode,
    remainingTtlSeconds: result.remainingTtlSeconds,
  });
}

function logSendStart(input: {
  driverId: string;
  bookingId: string;
  offerId: string;
  tokenSuffix: string;
  deviceId: string;
}): void {
  logger.info({
    event: 'DriverPush.booking_offer_send_start',
    platform: 'android+apns',
    tokenSuffix: input.tokenSuffix,
    offerId: input.offerId,
    bookingId: input.bookingId,
    driverId: input.driverId,
    deviceId: input.deviceId,
  });
}

function logSendSuccess(input: {
  offerId: string;
  tokenSuffix: string;
  messageId: string;
}): void {
  logger.info({
    event: 'DriverPush.booking_offer_send_success',
    messageId: input.messageId,
    tokenSuffix: input.tokenSuffix,
    offerId: input.offerId,
  });
}

function logSendFailed(input: {
  offerId: string;
  tokenSuffix: string;
  code: string;
}): void {
  logger.warn({
    event: 'DriverPush.booking_offer_send_failed',
    code: input.code,
    tokenSuffix: input.tokenSuffix,
    offerId: input.offerId,
  });
}

export async function sendDriverOfferPush(
  input: SendDriverOfferPushInput
): Promise<SendDriverOfferPushResult> {
  const remainingTtlSeconds = remainingOfferTtlSeconds(input.expiresAt);

  if (!shouldSendOfferPush(input.expiresAt) || remainingTtlSeconds <= 0) {
    const result: SendDriverOfferPushResult = {
      pushAttempted: false,
      pushSent: false,
      pushFailureCode: 'OFFER_EXPIRED',
      remainingTtlSeconds,
      deviceId: null,
    };
    logPush(input, result);
    return result;
  }

  if (!isFcmEnabled()) {
    const result: SendDriverOfferPushResult = {
      pushAttempted: false,
      pushSent: false,
      pushFailureCode: 'FCM_DISABLED',
      remainingTtlSeconds,
      deviceId: null,
    };
    logPush(input, result);
    return result;
  }

  const ready = await isFcmReady();
  if (!ready) {
    const result: SendDriverOfferPushResult = {
      pushAttempted: false,
      pushSent: false,
      pushFailureCode: 'FCM_UNAVAILABLE',
      remainingTtlSeconds,
      deviceId: null,
    };
    logPush(input, result);
    return result;
  }

  const driverRow = await findDriverSessionForPush(input.driverId);

  if (!driverRow?.activeDeviceId || !driverRow.activeSessionId) {
    const result: SendDriverOfferPushResult = {
      pushAttempted: false,
      pushSent: false,
      pushFailureCode: 'NO_ACTIVE_DEVICE',
      remainingTtlSeconds,
      deviceId: driverRow?.activeDeviceId ?? null,
    };
    logPush(input, result);
    return result;
  }

  const tokenRow = await findEnabledPushTokenForDriverDevice(
    input.driverId,
    driverRow.activeDeviceId
  );

  if (
    !tokenRow ||
    !tokenRow.enabled ||
    tokenRow.sessionId !== driverRow.activeSessionId ||
    tokenRow.deviceId !== driverRow.activeDeviceId
  ) {
    const result: SendDriverOfferPushResult = {
      pushAttempted: false,
      pushSent: false,
      pushFailureCode: 'NO_TOKEN',
      remainingTtlSeconds,
      deviceId: driverRow.activeDeviceId,
    };
    logPush(input, result);
    return result;
  }

  const tokenSuffix = fcmTokenSuffix(tokenRow.fcmToken);
  const message = buildDriverOfferFcmMessage({
    token: tokenRow.fcmToken,
    offerId: input.offerId,
    bookingId: input.bookingId,
    ttlSeconds: remainingTtlSeconds,
  });

  let lastCode: string | null = null;
  for (let attempt = 1; attempt <= FCM_TRANSIENT_MAX_ATTEMPTS; attempt += 1) {
    const ttlNow = remainingOfferTtlSeconds(input.expiresAt);
    if (ttlNow <= 0) {
      const result: SendDriverOfferPushResult = {
        pushAttempted: true,
        pushSent: false,
        pushFailureCode: 'OFFER_EXPIRED',
        remainingTtlSeconds: ttlNow,
        deviceId: tokenRow.deviceId,
      };
      logPush(input, result);
      return result;
    }

    logSendStart({
      driverId: input.driverId,
      bookingId: input.bookingId,
      offerId: input.offerId,
      tokenSuffix,
      deviceId: tokenRow.deviceId,
    });

    try {
      const messageId = await sendFcmMessage(message);
      logSendSuccess({
        offerId: input.offerId,
        tokenSuffix,
        messageId,
      });
      const result: SendDriverOfferPushResult = {
        pushAttempted: true,
        pushSent: true,
        pushFailureCode: null,
        remainingTtlSeconds: ttlNow,
        deviceId: tokenRow.deviceId,
      };
      logPush(input, result);
      return result;
    } catch (error) {
      const failureClass = classifyFcmError(error);
      lastCode = getFcmErrorCode(error);
      logSendFailed({
        offerId: input.offerId,
        tokenSuffix,
        code: lastCode,
      });

      if (failureClass === 'permanent_token') {
        await cleanupInvalidPushToken(tokenRow.id);
        const result: SendDriverOfferPushResult = {
          pushAttempted: true,
          pushSent: false,
          pushFailureCode: lastCode,
          remainingTtlSeconds: ttlNow,
          deviceId: tokenRow.deviceId,
        };
        logPush(input, result);
        return result;
      }

      if (failureClass === 'transient' && attempt < FCM_TRANSIENT_MAX_ATTEMPTS && ttlNow > 0) {
        await sleep(FCM_TRANSIENT_RETRY_DELAY_MS);
        continue;
      }

      const result: SendDriverOfferPushResult = {
        pushAttempted: true,
        pushSent: false,
        pushFailureCode: lastCode,
        remainingTtlSeconds: ttlNow,
        deviceId: tokenRow.deviceId,
      };
      logPush(input, result);
      return result;
    }
  }

  const result: SendDriverOfferPushResult = {
    pushAttempted: true,
    pushSent: false,
    pushFailureCode: lastCode,
    remainingTtlSeconds,
    deviceId: tokenRow.deviceId,
  };
  logPush(input, result);
  return result;
}

export function scheduleDriverOfferPush(input: SendDriverOfferPushInput): void {
  void sendDriverOfferPush(input).catch((error) => {
    logger.warn({
      event: 'driver.push.isolated_failure',
      driverId: input.driverId,
      bookingId: input.bookingId,
      offerId: input.offerId,
      pushAttempted: true,
      pushSent: false,
      pushFailureCode: 'ISOLATED_EXCEPTION',
      message: error instanceof Error ? error.message : 'unknown',
    });
  });
}
