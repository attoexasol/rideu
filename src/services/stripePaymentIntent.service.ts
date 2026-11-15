/**
 * Platform PaymentIntent authorization (Phase C).
 * Capture and authorization-release live in stripeCapture.service.ts (Phase D).
 * Does not create destination charges or transfers.
 */

import type Stripe from 'stripe';
import {
  BookingPaymentStatus,
  FinancialIdempotencyKey,
  PaymentMethodCode,
  PaymentProvider,
  type BookingPaymentStatusType,
} from '../constants/payment';
import { logger } from '../middleware/logger';
import {
  claimPendingCardPayment,
  findBookingPaymentByBookingId,
  findBookingPaymentByProviderPaymentIntentId,
  updateBookingPayment,
} from '../repositories/bookingPayment.repository';
import { findBookingById } from '../repositories/booking.repository';
import { majorToMinorUnits } from '../utils/money';
import { PaymentError } from './payment.errors';
import { METER_CHECKOUT_PURPOSE } from '../constants/softMeter';
import { getStripeClient } from './stripe.service';

const paymentIntentLocks = new Map<string, Promise<CardPaymentClientView>>();

export function resetPaymentIntentLocksForTests(): void {
  paymentIntentLocks.clear();
}

export type CardPaymentClientView = {
  method: typeof PaymentMethodCode.CARD;
  paymentIntentId: string;
  clientSecret: string | null;
  status: BookingPaymentStatusType;
  amount: number;
  currency: string;
};

const TERMINAL_LEDGER_STATUSES: BookingPaymentStatusType[] = [
  BookingPaymentStatus.CAPTURED,
  BookingPaymentStatus.REFUNDED,
  BookingPaymentStatus.CANCELLED,
];

export function normalizePaymentIntentStatus(
  intent: Pick<Stripe.PaymentIntent, 'status' | 'amount_capturable'>
): BookingPaymentStatusType {
  if (intent.status === 'requires_capture' || (intent.amount_capturable ?? 0) > 0) {
    return BookingPaymentStatus.AUTHORIZED;
  }
  switch (intent.status) {
    case 'requires_action':
      return BookingPaymentStatus.REQUIRES_ACTION;
    case 'requires_payment_method':
    case 'requires_confirmation':
      return BookingPaymentStatus.REQUIRES_PAYMENT_METHOD;
    case 'processing':
      return BookingPaymentStatus.PENDING;
    case 'canceled':
      return BookingPaymentStatus.CANCELLED;
    case 'succeeded':
      return BookingPaymentStatus.CAPTURED;
    default:
      return BookingPaymentStatus.PENDING;
  }
}

export function isPaymentAuthorized(status: string): boolean {
  return status === BookingPaymentStatus.AUTHORIZED || status === BookingPaymentStatus.CAPTURED;
}

function shouldReplaceLedgerStatus(
  current: BookingPaymentStatusType,
  next: BookingPaymentStatusType
): boolean {
  if (current === next) return false;
  if (TERMINAL_LEDGER_STATUSES.includes(current) && next !== BookingPaymentStatus.REFUNDED) {
    return false;
  }
  if (current === BookingPaymentStatus.CAPTURE_PENDING) {
    return (
      next === BookingPaymentStatus.CAPTURED ||
      next === BookingPaymentStatus.FAILED ||
      next === BookingPaymentStatus.CANCELLED
    );
  }
  if (current === BookingPaymentStatus.AUTHORIZED) {
    return (
      next === BookingPaymentStatus.CAPTURED ||
      next === BookingPaymentStatus.CANCELLED ||
      next === BookingPaymentStatus.CAPTURE_PENDING
    );
  }
  return true;
}

function mapStripePaymentIntentCreateError(error: unknown): never {
  const err = error as { code?: string; param?: string; type?: string; message?: string };
  logger.warn({
    type: 'stripe.payment_intent.create_failed',
    stripeErrorType: err.type,
    stripeErrorCode: err.code,
    stripeErrorParam: err.param,
  });
  const message = typeof err.message === 'string' ? err.message : '';
  if (err.param === 'currency' || /currency/i.test(message) || err.code === 'currency_unsupported') {
    throw new PaymentError(
      'STRIPE_CURRENCY_UNSUPPORTED',
      'Stripe rejected the booking currency for card payments. Fare currency was not changed.',
      400
    );
  }
  throw new PaymentError(
    'STRIPE_PAYMENT_INTENT_CREATE_FAILED',
    'Unable to create a card payment authorization.',
    502
  );
}

export function buildPlatformPaymentIntentParams(input: {
  amountMinor: number;
  currency: string;
  bookingId: string;
  passengerId: string;
}): Stripe.PaymentIntentCreateParams {
  return {
    amount: input.amountMinor,
    currency: input.currency.toLowerCase(),
    capture_method: 'manual',
    payment_method_types: ['card'],
    metadata: {
      bookingId: input.bookingId,
      passengerId: input.passengerId,
    },
  };
}

function toClientView(
  intent: Stripe.PaymentIntent,
  ledgerStatus: BookingPaymentStatusType
): CardPaymentClientView {
  const includeSecret =
    ledgerStatus === BookingPaymentStatus.REQUIRES_PAYMENT_METHOD ||
    ledgerStatus === BookingPaymentStatus.REQUIRES_ACTION ||
    ledgerStatus === BookingPaymentStatus.PENDING;
  return {
    method: PaymentMethodCode.CARD,
    paymentIntentId: intent.id,
    clientSecret: includeSecret ? intent.client_secret ?? null : null,
    status: ledgerStatus,
    amount: intent.amount,
    currency: intent.currency.toUpperCase(),
  };
}

export async function persistLedgerFromIntent(
  bookingId: string,
  intent: Stripe.PaymentIntent
): Promise<BookingPaymentStatusType> {
  const nextStatus = normalizePaymentIntentStatus(intent);
  const existing = await findBookingPaymentByBookingId(bookingId);
  const current = (existing?.status as BookingPaymentStatusType | undefined) ?? BookingPaymentStatus.PENDING;
  const status = shouldReplaceLedgerStatus(current, nextStatus) ? nextStatus : current;

  const chargeId =
    typeof intent.latest_charge === 'string'
      ? intent.latest_charge
      : intent.latest_charge && typeof intent.latest_charge === 'object'
        ? intent.latest_charge.id
        : existing?.providerChargeId ?? null;

  const patch: Parameters<typeof updateBookingPayment>[1] = {
    providerPaymentIntentId: intent.id,
    status,
    failureCode: null,
    failureMessage: null,
  };
  if (chargeId) patch.providerChargeId = chargeId;
  if (status === BookingPaymentStatus.AUTHORIZED && !existing?.authorizedAt) {
    patch.authorizedAt = new Date();
  }
  if (status === BookingPaymentStatus.CAPTURED && !existing?.capturedAt) {
    patch.capturedAt = new Date();
  }
  if (status === BookingPaymentStatus.FAILED || nextStatus === BookingPaymentStatus.FAILED) {
    patch.failedAt = new Date();
    patch.failureCode = intent.last_payment_error?.code?.slice(0, 100) ?? 'payment_failed';
    patch.failureMessage = intent.last_payment_error?.message?.slice(0, 500) ?? null;
  }
  if (nextStatus === BookingPaymentStatus.FAILED && status === BookingPaymentStatus.FAILED) {
    patch.status = BookingPaymentStatus.FAILED;
  }
  if (status === BookingPaymentStatus.CANCELLED) {
    patch.failureCode = patch.failureCode ?? 'canceled';
  }

  await updateBookingPayment(bookingId, patch);
  return status;
}

async function createOrReusePaymentIntent(input: {
  bookingId: string;
  passengerId: string;
  amountMinor: number;
  currency: string;
}): Promise<Stripe.PaymentIntent> {
  const stripe = getStripeClient();
  const existing = await findBookingPaymentByBookingId(input.bookingId);
  if (existing?.providerPaymentIntentId) {
    return stripe.paymentIntents.retrieve(existing.providerPaymentIntentId);
  }

  const params = buildPlatformPaymentIntentParams({
    amountMinor: input.amountMinor,
    currency: input.currency,
    bookingId: input.bookingId,
    passengerId: input.passengerId,
  });

  try {
    return await stripe.paymentIntents.create(params, {
      idempotencyKey: FinancialIdempotencyKey.payment(input.bookingId),
    });
  } catch (error) {
    mapStripePaymentIntentCreateError(error);
  }
}

export async function prepareCardPaymentForBooking(input: {
  bookingId: string;
  passengerId: string;
  finalFare: string | number | null | undefined;
  currency: string;
}): Promise<CardPaymentClientView> {
  const existingLock = paymentIntentLocks.get(input.bookingId);
  if (existingLock) return existingLock;

  const work = (async () => {
    const amountMinor = majorToMinorUnits(String(input.finalFare ?? ''));
    if (amountMinor <= 0) {
      throw new PaymentError(
        'INVALID_PAYMENT_AMOUNT',
        'Booking fare must be greater than zero for card payment.',
        400
      );
    }

    await claimPendingCardPayment({
      bookingId: input.bookingId,
      paymentMethod: PaymentMethodCode.CARD,
      currency: input.currency.toUpperCase(),
      grossAmount: amountMinor,
      provider: PaymentProvider.STRIPE,
      status: BookingPaymentStatus.PENDING,
    });

    const intent = await createOrReusePaymentIntent({
      bookingId: input.bookingId,
      passengerId: input.passengerId,
      amountMinor,
      currency: input.currency,
    });

    logger.info({
      type: 'stripe.payment_intent.prepared',
      bookingId: input.bookingId,
      paymentIntentId: intent.id,
      amount: intent.amount,
      currency: intent.currency,
      captureMethod: intent.capture_method,
    });

    const status = await persistLedgerFromIntent(input.bookingId, intent);
    return toClientView(intent, status);
  })().finally(() => {
    paymentIntentLocks.delete(input.bookingId);
  });

  paymentIntentLocks.set(input.bookingId, work);
  return work;
}

export async function reconcileBookingPaymentFromStripe(
  bookingId: string
): Promise<CardPaymentClientView> {
  const payment = await findBookingPaymentByBookingId(bookingId);
  if (!payment?.providerPaymentIntentId) {
    throw new PaymentError(
      'PAYMENT_NOT_FOUND',
      'No card payment exists for this booking.',
      404
    );
  }
  const intent = await getStripeClient().paymentIntents.retrieve(payment.providerPaymentIntentId);
  const status = await persistLedgerFromIntent(bookingId, intent);
  return toClientView(intent, status);
}

export async function getBookingPaymentView(
  bookingId: string,
  options: { reconcile?: boolean } = {}
): Promise<{
  paymentMethod: string;
  status: string;
  paymentIntentId: string | null;
  amount: number;
  currency: string;
  clientSecret?: string | null;
}> {
  if (options.reconcile !== false) {
    const payment = await findBookingPaymentByBookingId(bookingId);
    if (payment?.providerPaymentIntentId && payment.paymentMethod === PaymentMethodCode.CARD) {
      const view = await reconcileBookingPaymentFromStripe(bookingId);
      return {
        paymentMethod: view.method,
        status: view.status,
        paymentIntentId: view.paymentIntentId,
        amount: view.amount,
        currency: view.currency,
        clientSecret: view.clientSecret,
      };
    }
  }

  const payment = await findBookingPaymentByBookingId(bookingId);
  if (!payment) {
    throw new PaymentError('PAYMENT_NOT_FOUND', 'No payment record for this booking.', 404);
  }
  return {
    paymentMethod: payment.paymentMethod,
    status: payment.status,
    paymentIntentId: payment.providerPaymentIntentId,
    amount: payment.grossAmount,
    currency: payment.currency,
  };
}

function extractPaymentIntent(event: Stripe.Event): Stripe.PaymentIntent | null {
  if (!event.type.startsWith('payment_intent.')) return null;
  const obj = event.data.object as Stripe.PaymentIntent;
  if (obj?.object === 'payment_intent' && typeof obj.id === 'string') return obj;
  return null;
}

export async function handleStripePaymentIntentEvent(event: Stripe.Event): Promise<{
  bookingId: string | null;
  status: BookingPaymentStatusType | null;
}> {
  const intent = extractPaymentIntent(event);
  if (!intent) {
    return { bookingId: null, status: null };
  }
  if (intent.metadata?.purpose === METER_CHECKOUT_PURPOSE.ON_DEMAND_TEST) {
    return { bookingId: null, status: null };
  }

  const fromMetadata =
    typeof intent.metadata?.bookingId === 'string' ? intent.metadata.bookingId : null;
  const row =
    (fromMetadata ? await findBookingPaymentByBookingId(fromMetadata) : null) ??
    (await findBookingPaymentByProviderPaymentIntentId(intent.id));

  if (!row) {
    logger.info({
      type: 'stripe.payment_intent.unknown_booking',
      stripeEventId: event.id,
      stripeEventType: event.type,
      paymentIntentId: intent.id,
    });
    return { bookingId: null, status: null };
  }

  if (event.type === 'payment_intent.payment_failed') {
    const existing = await findBookingPaymentByBookingId(row.bookingId);
    if (existing?.status !== BookingPaymentStatus.AUTHORIZED) {
      await updateBookingPayment(row.bookingId, {
        status: BookingPaymentStatus.FAILED,
        failedAt: new Date(),
        failureCode: intent.last_payment_error?.code?.slice(0, 100) ?? 'payment_failed',
        failureMessage: intent.last_payment_error?.message?.slice(0, 500) ?? null,
        providerPaymentIntentId: intent.id,
      });
      return { bookingId: row.bookingId, status: BookingPaymentStatus.FAILED };
    }
  }

  const status = await persistLedgerFromIntent(row.bookingId, intent);
  const booking = await findBookingById(row.bookingId);
  logger.info({
    type: 'stripe.payment_intent.reconciled',
    stripeEventId: event.id,
    stripeEventType: event.type,
    bookingId: row.bookingId,
    paymentIntentId: intent.id,
    ledgerStatus: status,
    bookingStatus: booking?.status,
  });
  return { bookingId: row.bookingId, status };
}
