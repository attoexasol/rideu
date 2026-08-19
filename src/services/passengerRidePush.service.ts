import { logger } from '../middleware/logger';
import {
  FCM_TRANSIENT_MAX_ATTEMPTS,
  FCM_TRANSIENT_RETRY_DELAY_MS,
  isFcmEnabled,
} from '../config/fcm';
import { isFcmReady, sendFcmMessage } from './fcmAdmin.service';
import {
  findCustomerSessionForPush,
  findEnabledPushTokenForPassengerDevice,
} from '../repositories/passengerPushToken.repository';
import { cleanupInvalidPassengerPushToken } from './passengerPushToken.service';
import {
  buildAndroidPassengerRideFcmMessage,
  classifyFcmError,
  getFcmErrorCode,
  isPassengerRidePushEvent,
  mapPassengerPushFailureCode,
  type PassengerRidePushEvent,
} from './passengerRidePush.payload';

export type SendPassengerRidePushInput = {
  customerId: string;
  bookingId: string;
  event: string;
  cancelledBy?: string | null;
};

export type SendPassengerRidePushResult = {
  pushAttempted: boolean;
  pushSent: boolean;
  pushFailureCode: string | null;
  deviceId: string | null;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logPush(input: SendPassengerRidePushInput, result: SendPassengerRidePushResult): void {
  const eventName = result.pushSent ? 'passenger.push.sent' : 'passenger.push.failed';
  logger.info({
    event: eventName,
    customerId: input.customerId,
    bookingId: input.bookingId,
    rideEvent: input.event,
    deviceId: result.deviceId,
    pushAttempted: result.pushAttempted,
    pushSent: result.pushSent,
    pushFailureCode: result.pushFailureCode,
  });
}

export async function sendPassengerRidePush(
  input: SendPassengerRidePushInput
): Promise<SendPassengerRidePushResult> {
  if (!isPassengerRidePushEvent(input.event)) {
    const result: SendPassengerRidePushResult = {
      pushAttempted: false,
      pushSent: false,
      pushFailureCode: 'EVENT_NOT_ELIGIBLE',
      deviceId: null,
    };
    logPush(input, result);
    return result;
  }

  const event = input.event as PassengerRidePushEvent;

  if (!isFcmEnabled()) {
    const result: SendPassengerRidePushResult = {
      pushAttempted: false,
      pushSent: false,
      pushFailureCode: 'FCM_DISABLED',
      deviceId: null,
    };
    logPush(input, result);
    return result;
  }

  const ready = await isFcmReady();
  if (!ready) {
    const result: SendPassengerRidePushResult = {
      pushAttempted: false,
      pushSent: false,
      pushFailureCode: 'FCM_UNAVAILABLE',
      deviceId: null,
    };
    logPush(input, result);
    return result;
  }

  const customerRow = await findCustomerSessionForPush(input.customerId);
  if (!customerRow?.activeDeviceId || !customerRow.activeSessionId) {
    const result: SendPassengerRidePushResult = {
      pushAttempted: false,
      pushSent: false,
      pushFailureCode: 'NO_ACTIVE_DEVICE',
      deviceId: customerRow?.activeDeviceId ?? null,
    };
    logPush(input, result);
    return result;
  }

  const tokenRow = await findEnabledPushTokenForPassengerDevice(
    input.customerId,
    customerRow.activeDeviceId
  );

  if (!tokenRow || !tokenRow.enabled) {
    const result: SendPassengerRidePushResult = {
      pushAttempted: false,
      pushSent: false,
      pushFailureCode: 'NO_TOKEN',
      deviceId: customerRow.activeDeviceId,
    };
    logPush(input, result);
    return result;
  }

  if (
    tokenRow.sessionId !== customerRow.activeSessionId ||
    tokenRow.deviceId !== customerRow.activeDeviceId
  ) {
    const result: SendPassengerRidePushResult = {
      pushAttempted: false,
      pushSent: false,
      pushFailureCode: 'SESSION_MISMATCH',
      deviceId: customerRow.activeDeviceId,
    };
    logPush(input, result);
    return result;
  }

  const message = buildAndroidPassengerRideFcmMessage({
    token: tokenRow.fcmToken,
    bookingId: input.bookingId,
    event,
    cancelledBy: input.cancelledBy,
  });

  let lastCode: string | null = null;
  for (let attempt = 1; attempt <= FCM_TRANSIENT_MAX_ATTEMPTS; attempt += 1) {
    try {
      await sendFcmMessage(message);
      const result: SendPassengerRidePushResult = {
        pushAttempted: true,
        pushSent: true,
        pushFailureCode: null,
        deviceId: tokenRow.deviceId,
      };
      logPush(input, result);
      return result;
    } catch (error) {
      const failureClass = classifyFcmError(error);
      lastCode = mapPassengerPushFailureCode(getFcmErrorCode(error));

      if (failureClass === 'permanent_token') {
        await cleanupInvalidPassengerPushToken(tokenRow.id);
        const result: SendPassengerRidePushResult = {
          pushAttempted: true,
          pushSent: false,
          pushFailureCode: lastCode,
          deviceId: tokenRow.deviceId,
        };
        logPush(input, result);
        return result;
      }

      if (failureClass === 'transient' && attempt < FCM_TRANSIENT_MAX_ATTEMPTS) {
        await sleep(FCM_TRANSIENT_RETRY_DELAY_MS);
        continue;
      }

      const result: SendPassengerRidePushResult = {
        pushAttempted: true,
        pushSent: false,
        pushFailureCode: lastCode,
        deviceId: tokenRow.deviceId,
      };
      logPush(input, result);
      return result;
    }
  }

  const result: SendPassengerRidePushResult = {
    pushAttempted: true,
    pushSent: false,
    pushFailureCode: lastCode,
    deviceId: tokenRow.deviceId,
  };
  logPush(input, result);
  return result;
}

export function schedulePassengerRidePush(input: SendPassengerRidePushInput): void {
  void sendPassengerRidePush(input).catch((error) => {
    logger.warn({
      event: 'passenger.push.failed',
      customerId: input.customerId,
      bookingId: input.bookingId,
      rideEvent: input.event,
      pushAttempted: true,
      pushSent: false,
      pushFailureCode: 'ISOLATED_EXCEPTION',
      message: error instanceof Error ? error.message : 'unknown',
    });
  });
}
