import { logger } from '../middleware/logger';
import { shouldSendPassengerRidePush } from './passengerRidePush.payload';
import type { SendPassengerRidePushInput } from './passengerRidePush.service';

/**
 * Isolated FCM wake-up after Socket.IO. Call only after booking state is committed
 * and the existing Passenger socket event has been emitted.
 * FCM failure must never affect booking results.
 */
export function notifyPassengerOfRideEvent(input: SendPassengerRidePushInput): void {
  if (!shouldSendPassengerRidePush(input.event)) {
    return;
  }

  void import('./passengerRidePush.service')
    .then(({ schedulePassengerRidePush }) => {
      schedulePassengerRidePush(input);
    })
    .catch((error) => {
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
