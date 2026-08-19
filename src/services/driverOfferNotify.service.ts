import { emitToDriver } from './bookingNotify.service';
import { logger } from '../middleware/logger';
import type { SendDriverOfferPushInput } from './driverOfferPush.service';

/**
 * Socket.IO emit plus failure-isolated FCM wake-up.
 * Call only after booking_offers persistence succeeds.
 */
export async function notifyDriverOfPersistedOffer(input: {
  driverId: string;
  bookingId: string;
  offerId: string;
  expiresAt: Date;
  socketPayload: unknown;
}): Promise<void> {
  await emitToDriver(input.driverId, 'booking:offer', input.socketPayload);

  const pushInput: SendDriverOfferPushInput = {
    driverId: input.driverId,
    bookingId: input.bookingId,
    offerId: input.offerId,
    expiresAt: input.expiresAt,
  };

  void import('./driverOfferPush.service')
    .then(({ scheduleDriverOfferPush }) => {
      scheduleDriverOfferPush(pushInput);
    })
    .catch((error) => {
      logger.warn({
        event: 'driver.push.isolated_failure',
        driverId: input.driverId,
        bookingId: input.bookingId,
        offerId: input.offerId,
        pushAttempted: true,
        pushSent: false,
        pushFailureCode: 'MODULE_LOAD_FAILED',
        message: error instanceof Error ? error.message : 'unknown',
      });
    });
}
