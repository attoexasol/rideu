/**
 * Phase D: capture an authorized platform PaymentIntent on ride completion,
 * and cancel/release authorization when the booking is terminally cancelled.
 *
 * Does not transfer, refund captured charges, or calculate commission.
 */

import type Stripe from 'stripe';
import {
  BookingPaymentStatus,
  FinancialIdempotencyKey,
  PaymentMethodCode,
  type BookingPaymentStatusType,
} from '../constants/payment';
import { logger } from '../middleware/logger';
import { findBookingById, updateBooking } from '../repositories/booking.repository';
import {
  findBookingPaymentByBookingId,
  updateBookingPayment,
} from '../repositories/bookingPayment.repository';
import { PaymentError } from './payment.errors';
import { ensureSettlementForCapturedPayment } from './settlement.service';
import { getStripeClient } from './stripe.service';
import {
  normalizePaymentIntentStatus,
  persistLedgerFromIntent,
} from './stripePaymentIntent.service';

const captureLocks = new Map<string, Promise<CaptureBookingPaymentResult>>();
const releaseLocks = new Map<string, Promise<ReleaseBookingPaymentResult>>();

export function resetCaptureLocksForTests(): void {
  captureLocks.clear();
  releaseLocks.clear();
}

export type CaptureBookingPaymentResult = {
  skipped: boolean;
  alreadyCaptured: boolean;
  status: string;
  paymentIntentId: string | null;
};

export type ReleaseBookingPaymentResult = {
  skipped: boolean;
  released: boolean;
  alreadyReleased: boolean;
  alreadyCaptured: boolean;
  status: string;
  paymentIntentId: string | null;
};

const CANCELABLE_STRIPE_STATUSES = new Set<Stripe.PaymentIntent.Status>([
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
  'requires_capture',
  'processing',
]);

function stripeErrorFields(error: unknown): {
  code?: string;
  type?: string;
  message: string;
} {
  const err = error as { code?: string; type?: string; message?: string };
  return {
    code: err.code,
    type: err.type,
    message: typeof err.message === 'string' ? err.message : 'Stripe request failed',
  };
}

function assertIntentMatchesBooking(intent: Stripe.PaymentIntent, bookingId: string): void {
  const metaBookingId =
    typeof intent.metadata?.bookingId === 'string' ? intent.metadata.bookingId : null;
  if (metaBookingId && metaBookingId !== bookingId) {
    throw new PaymentError(
      'STRIPE_PAYMENT_NOT_CAPTURABLE',
      'Stripe PaymentIntent is not linked to this booking.',
      409
    );
  }
}

export async function markBookingPaidIfCaptured(bookingId: string): Promise<void> {
  const payment = await findBookingPaymentByBookingId(bookingId);
  if (!payment || payment.paymentMethod !== PaymentMethodCode.CARD) return;
  if (payment.status !== BookingPaymentStatus.CAPTURED) return;
  const booking = await findBookingById(bookingId);
  if (booking && booking.paymentStatus !== 'paid') {
    await updateBooking(bookingId, { paymentStatus: 'paid' });
    logger.info({
      type: 'stripe.payment.booking_marked_paid',
      bookingId,
      paymentIntentId: payment.providerPaymentIntentId,
    });
  }
  await ensureSettlementForCapturedPayment(bookingId);
}

async function persistCapturedIntent(
  bookingId: string,
  intent: Stripe.PaymentIntent
): Promise<BookingPaymentStatusType> {
  const status = await persistLedgerFromIntent(bookingId, intent);
  if (status === BookingPaymentStatus.CAPTURED) {
    await markBookingPaidIfCaptured(bookingId);
  }
  return status;
}

export async function captureAuthorizedBookingPayment(
  bookingId: string
): Promise<CaptureBookingPaymentResult> {
  const existing = captureLocks.get(bookingId);
  if (existing) return existing;

  const work = (async () => {
    const payment = await findBookingPaymentByBookingId(bookingId);
    if (!payment || payment.paymentMethod !== PaymentMethodCode.CARD) {
      return {
        skipped: true,
        alreadyCaptured: false,
        status: payment?.status ?? 'skipped_cash',
        paymentIntentId: payment?.providerPaymentIntentId ?? null,
      };
    }

    if (payment.status === BookingPaymentStatus.CAPTURED) {
      await markBookingPaidIfCaptured(bookingId);
      return {
        skipped: false,
        alreadyCaptured: true,
        status: BookingPaymentStatus.CAPTURED,
        paymentIntentId: payment.providerPaymentIntentId,
      };
    }

    if (!payment.providerPaymentIntentId) {
      throw new PaymentError(
        'STRIPE_PAYMENT_NOT_CAPTURABLE',
        'Card payment has no PaymentIntent to capture.',
        409
      );
    }

    const stripe = getStripeClient();
    const retrieved = await stripe.paymentIntents.retrieve(payment.providerPaymentIntentId);
    assertIntentMatchesBooking(retrieved, bookingId);

    const remoteStatus = normalizePaymentIntentStatus(retrieved);
    if (
      retrieved.status === 'succeeded' ||
      remoteStatus === BookingPaymentStatus.CAPTURED
    ) {
      const status = await persistCapturedIntent(bookingId, retrieved);
      return {
        skipped: false,
        alreadyCaptured: true,
        status,
        paymentIntentId: retrieved.id,
      };
    }

    const capturable =
      retrieved.status === 'requires_capture' || (retrieved.amount_capturable ?? 0) > 0;
    if (!capturable && payment.status !== BookingPaymentStatus.CAPTURE_PENDING) {
      throw new PaymentError(
        'STRIPE_PAYMENT_NOT_CAPTURABLE',
        'Card payment is not authorized for capture.',
        409
      );
    }
    if (!capturable) {
      throw new PaymentError(
        'STRIPE_PAYMENT_NOT_CAPTURABLE',
        'Card payment is not currently capturable.',
        409
      );
    }

    if (
      payment.status === BookingPaymentStatus.AUTHORIZED ||
      payment.status === BookingPaymentStatus.CAPTURE_PENDING
    ) {
      await updateBookingPayment(bookingId, {
        status: BookingPaymentStatus.CAPTURE_PENDING,
        failureCode: null,
        failureMessage: null,
      });
    }

    try {
      const captured = await stripe.paymentIntents.capture(
        retrieved.id,
        {},
        { idempotencyKey: FinancialIdempotencyKey.capture(bookingId) }
      );
      logger.info({
        type: 'stripe.payment_intent.captured',
        bookingId,
        paymentIntentId: captured.id,
        stripeStatus: captured.status,
      });
      const status = await persistCapturedIntent(bookingId, captured);
      return {
        skipped: false,
        alreadyCaptured: false,
        status,
        paymentIntentId: captured.id,
      };
    } catch (error) {
      const fields = stripeErrorFields(error);
      logger.warn({
        type: 'stripe.payment_intent.capture_failed',
        bookingId,
        paymentIntentId: retrieved.id,
        stripeErrorType: fields.type,
        stripeErrorCode: fields.code,
      });

      const latest = await stripe.paymentIntents
        .retrieve(retrieved.id)
        .catch(() => null);
      if (
        latest &&
        (latest.status === 'succeeded' ||
          normalizePaymentIntentStatus(latest) === BookingPaymentStatus.CAPTURED)
      ) {
        const status = await persistCapturedIntent(bookingId, latest);
        return {
          skipped: false,
          alreadyCaptured: true,
          status,
          paymentIntentId: latest.id,
        };
      }

      await updateBookingPayment(bookingId, {
        status: BookingPaymentStatus.CAPTURE_PENDING,
        failureCode: (fields.code ?? 'capture_failed').slice(0, 100),
        failureMessage: fields.message.slice(0, 500),
      });
      throw new PaymentError(
        'STRIPE_CAPTURE_FAILED',
        'Ride is completed but card capture could not be confirmed. Retry is safe.',
        502
      );
    }
  })().finally(() => {
    captureLocks.delete(bookingId);
  });

  captureLocks.set(bookingId, work);
  return work;
}

export async function releaseCardPaymentAuthorization(
  bookingId: string
): Promise<ReleaseBookingPaymentResult> {
  const existing = releaseLocks.get(bookingId);
  if (existing) return existing;

  const work = (async () => {
    const payment = await findBookingPaymentByBookingId(bookingId);
    if (!payment || payment.paymentMethod !== PaymentMethodCode.CARD) {
      return {
        skipped: true,
        released: false,
        alreadyReleased: false,
        alreadyCaptured: false,
        status: payment?.status ?? 'skipped_cash',
        paymentIntentId: payment?.providerPaymentIntentId ?? null,
      };
    }

    if (payment.status === BookingPaymentStatus.CANCELLED) {
      return {
        skipped: false,
        released: false,
        alreadyReleased: true,
        alreadyCaptured: false,
        status: BookingPaymentStatus.CANCELLED,
        paymentIntentId: payment.providerPaymentIntentId,
      };
    }

    if (
      payment.status === BookingPaymentStatus.CAPTURED ||
      payment.status === BookingPaymentStatus.REFUNDED
    ) {
      logger.info({
        type: 'stripe.payment_intent.release_skipped_captured',
        bookingId,
        paymentIntentId: payment.providerPaymentIntentId,
        ledgerStatus: payment.status,
      });
      return {
        skipped: false,
        released: false,
        alreadyReleased: false,
        alreadyCaptured: true,
        status: payment.status,
        paymentIntentId: payment.providerPaymentIntentId,
      };
    }

    if (!payment.providerPaymentIntentId) {
      await updateBookingPayment(bookingId, {
        status: BookingPaymentStatus.CANCELLED,
        failureCode: 'canceled',
        failureMessage: null,
      });
      return {
        skipped: false,
        released: true,
        alreadyReleased: false,
        alreadyCaptured: false,
        status: BookingPaymentStatus.CANCELLED,
        paymentIntentId: null,
      };
    }

    const stripe = getStripeClient();
    let intent: Stripe.PaymentIntent;
    try {
      intent = await stripe.paymentIntents.retrieve(payment.providerPaymentIntentId);
    } catch (error) {
      const fields = stripeErrorFields(error);
      logger.warn({
        type: 'stripe.payment_intent.cancel_retrieve_failed',
        bookingId,
        paymentIntentId: payment.providerPaymentIntentId,
        stripeErrorType: fields.type,
        stripeErrorCode: fields.code,
      });
      throw new PaymentError(
        'STRIPE_PAYMENT_CANCEL_FAILED',
        'Could not release card authorization. Retry is safe.',
        502
      );
    }

    assertIntentMatchesBooking(intent, bookingId);

    if (intent.status === 'succeeded') {
      const status = await persistCapturedIntent(bookingId, intent);
      logger.info({
        type: 'stripe.payment_intent.release_skipped_already_captured',
        bookingId,
        paymentIntentId: intent.id,
        stripeStatus: intent.status,
      });
      return {
        skipped: false,
        released: false,
        alreadyReleased: false,
        alreadyCaptured: true,
        status,
        paymentIntentId: intent.id,
      };
    }

    if (intent.status === 'canceled') {
      const status = await persistLedgerFromIntent(bookingId, intent);
      return {
        skipped: false,
        released: false,
        alreadyReleased: true,
        alreadyCaptured: false,
        status,
        paymentIntentId: intent.id,
      };
    }

    if (!CANCELABLE_STRIPE_STATUSES.has(intent.status)) {
      throw new PaymentError(
        'STRIPE_PAYMENT_CANCEL_FAILED',
        'Card PaymentIntent cannot be cancelled in its current Stripe status.',
        409
      );
    }

    try {
      const canceled = await stripe.paymentIntents.cancel(
        intent.id,
        {},
        { idempotencyKey: FinancialIdempotencyKey.paymentCancel(bookingId) }
      );
      logger.info({
        type: 'stripe.payment_intent.authorization_released',
        bookingId,
        paymentIntentId: canceled.id,
        stripeStatus: canceled.status,
      });
      const status = await persistLedgerFromIntent(bookingId, canceled);
      return {
        skipped: false,
        released: true,
        alreadyReleased: false,
        alreadyCaptured: false,
        status,
        paymentIntentId: canceled.id,
      };
    } catch (error) {
      const fields = stripeErrorFields(error);
      const latest = await stripe.paymentIntents.retrieve(intent.id).catch(() => null);
      if (latest?.status === 'canceled') {
        const status = await persistLedgerFromIntent(bookingId, latest);
        return {
          skipped: false,
          released: false,
          alreadyReleased: true,
          alreadyCaptured: false,
          status,
          paymentIntentId: latest.id,
        };
      }
      if (latest?.status === 'succeeded') {
        const status = await persistCapturedIntent(bookingId, latest);
        return {
          skipped: false,
          released: false,
          alreadyReleased: false,
          alreadyCaptured: true,
          status,
          paymentIntentId: latest.id,
        };
      }
      logger.warn({
        type: 'stripe.payment_intent.cancel_failed',
        bookingId,
        paymentIntentId: intent.id,
        stripeErrorType: fields.type,
        stripeErrorCode: fields.code,
      });
      await updateBookingPayment(bookingId, {
        failureCode: (fields.code ?? 'cancel_failed').slice(0, 100),
        failureMessage: fields.message.slice(0, 500),
      });
      throw new PaymentError(
        'STRIPE_PAYMENT_CANCEL_FAILED',
        'Booking is cancelled but card authorization could not be released. Retry is safe.',
        502
      );
    }
  })().finally(() => {
    releaseLocks.delete(bookingId);
  });

  releaseLocks.set(bookingId, work);
  return work;
}
