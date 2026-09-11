/**
 * Idempotent dispatch start for card bookings after PaymentIntent authorization.
 * Cash dispatch is unchanged (starts at booking create).
 */

import { and, eq } from 'drizzle-orm';
import { BookingStatus } from '../constants/bookingStatus';
import { db } from '../db/connection';
import { bookings } from '../db/schema/bookings';
import { bookingEvents } from '../db/schema/booking_events';
import { findBookingPaymentByBookingId } from '../repositories/bookingPayment.repository';
import { startDispatch } from './dispatch.service';
import { isPaymentAuthorized } from './stripePaymentIntent.service';
import { logger } from '../middleware/logger';

export type CardDispatchActivationResult = {
  dispatched: boolean;
  alreadyActive: boolean;
  bookingStatus: string;
};

export function shouldStartDispatchOnBookingCreate(input: {
  isScheduled: boolean;
  paymentMethodCode: string;
}): boolean {
  if (input.isScheduled) return false;
  if (input.paymentMethodCode === 'card') return false;
  return true;
}

/**
 * Move an authorized card booking from `quoted` to `searching` and start dispatch once.
 * Scheduled card bookings stay scheduled (no dispatch) after authorization.
 */
export async function activateAuthorizedCardBooking(
  bookingId: string
): Promise<CardDispatchActivationResult> {
  const payment = await findBookingPaymentByBookingId(bookingId);
  if (!payment || payment.paymentMethod !== 'card') {
    const booking = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
    return {
      dispatched: false,
      alreadyActive: false,
      bookingStatus: booking[0]?.status ?? 'unknown',
    };
  }

  if (!isPaymentAuthorized(payment.status)) {
    const booking = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
    return {
      dispatched: false,
      alreadyActive: false,
      bookingStatus: booking[0]?.status ?? 'unknown',
    };
  }

  const outcome = await db.transaction(async (tx) => {
    const locked = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .for('update')
      .limit(1);
    const current = locked[0];
    if (!current) {
      return { dispatched: false, alreadyActive: false, bookingStatus: 'unknown' as string, shouldDispatch: false };
    }

    if (current.status === BookingStatus.SCHEDULED) {
      return {
        dispatched: false,
        alreadyActive: true,
        bookingStatus: current.status,
        shouldDispatch: false,
      };
    }

    if (current.status !== BookingStatus.QUOTED) {
      return {
        dispatched: false,
        alreadyActive: true,
        bookingStatus: current.status,
        shouldDispatch: false,
      };
    }

    await tx
      .update(bookings)
      .set({
        status: BookingStatus.SEARCHING,
        searchStartedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(bookings.id, bookingId), eq(bookings.status, BookingStatus.QUOTED)));

    await tx.insert(bookingEvents).values({
      bookingId,
      actorType: 'system',
      actorId: null,
      eventType: 'card_payment_authorized',
      payload: { from: BookingStatus.QUOTED, to: BookingStatus.SEARCHING },
    });

    return {
      dispatched: true,
      alreadyActive: false,
      bookingStatus: BookingStatus.SEARCHING,
      shouldDispatch: true,
    };
  });

  if (outcome.shouldDispatch) {
    await startDispatch(bookingId);
    logger.info({
      type: 'stripe.card_booking.dispatched',
      bookingId,
    });
  }

  return {
    dispatched: outcome.dispatched,
    alreadyActive: outcome.alreadyActive,
    bookingStatus: outcome.bookingStatus,
  };
}
