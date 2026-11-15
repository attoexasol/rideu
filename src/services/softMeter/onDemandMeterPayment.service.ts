import {
  MeterPaymentStatus,
  MeterSettlementMode,
  TEST_ONLY_UNAPPROVED_TARIFF,
  type MeterPaymentStatusType,
} from '../../constants/softMeter';
import type { MeterPayment } from '../../db/schema/meter_payments';
import { logger } from '../../middleware/logger';
import {
  findBookingById,
  insertBookingEvent,
  updateBooking,
} from '../../repositories/booking.repository';
import { findBookingPaymentByBookingId } from '../../repositories/bookingPayment.repository';
import {
  findLatestUnpaidOnDemandMeterPayment,
  findMeterPaymentByBooking,
  findMeterPaymentByFare,
  findMeterPaymentById,
  findMeterPaymentsByBookingIds,
  insertMeterPayment,
  updateMeterPayment,
} from '../../repositories/meterPayment.repository';
import { findFareBySession, findMeterByBooking } from '../../repositories/meterSession.repository';
import { releaseCardPaymentAuthorization } from '../payment.service';
import { getStripePublishableKey } from '../../config/stripe';
import { getStripeClient } from '../stripe.service';
import { MeterError, isUniqueViolation } from './errors';
import { finalizeMeterSession } from './meterSession.service';
import { emitBookingMeterPayment } from './meterNotify.service';
import type Stripe from 'stripe';
import {
  assessLegacyCheckout,
  evaluateOnDemandStripeTestConfig,
  onDemandCompletionSettlement,
  openOnDemandTestCheckout,
  openOnDemandTestPaymentIntent,
  readOnDemandStripeTestConfig,
  reconcileStoredOnDemandPaymentIntent,
  runOnDemandFarePaymentLock,
  type LegacyCheckoutSnapshot,
  type PaymentIntentReconcileCommit,
  type PaymentIntentReconcileState,
  toOnDemandMeterPaymentView,
  type OnDemandMeterPaymentView,
} from './onDemandMeterPayment';
import {
  meterPaymentIntentWebhookDecision,
  type StoredPaymentIntentSnapshot,
} from './paymentState';
import type { RateSnapshot } from './rules';
import { createStripeHostedCheckout } from './meterPayment.service';
import type { StoredTestPayment } from './testPayment';

function toStored(row: MeterPayment): StoredTestPayment {
  return {
    id: row.id,
    status: row.status as MeterPaymentStatusType,
    hostedUrl: row.hostedUrl,
    stripeCheckoutSessionId: row.stripeCheckoutSessionId,
    stripePaymentIntentId: row.stripePaymentIntentId,
    receiptUrl: row.receiptUrl,
    amountCents: row.amountCents,
    currency: row.currency,
    settlementMode: row.settlementMode as StoredTestPayment['settlementMode'],
    testOnly: row.testOnly,
    fareClassification: row.fareClassification,
    expiresAtMs: row.expiresAt?.getTime() ?? null,
    fareRecordId: row.fareRecordId,
    idempotencyKey: row.idempotencyKey,
    failureCode: row.failureCode,
    paidAtMs: row.paidAt?.getTime() ?? null,
    createdAtMs: row.createdAt.getTime(),
    updatedAtMs: row.updatedAt.getTime(),
  };
}

function checkoutSnapshot(session: Stripe.Checkout.Session): LegacyCheckoutSnapshot {
  const paymentIntent = session.payment_intent;
  const intent = paymentIntent && typeof paymentIntent === 'object' ? paymentIntent : null;
  const charge = intent?.latest_charge;
  const receiptUrl =
    charge && typeof charge === 'object' ? charge.receipt_url ?? null : null;
  return {
    status: session.status ?? 'open',
    paymentStatus: session.payment_status,
    livemode: session.livemode,
    amountTotal: session.amount_total,
    currency: session.currency,
    purpose: session.metadata?.purpose ?? null,
    bookingId: session.metadata?.bookingId ?? null,
    paymentIntent: intent
      ? {
          id: intent.id,
          status: intent.status,
          livemode: intent.livemode,
          amount: intent.amount,
          currency: intent.currency,
          receiptUrl,
        }
      : null,
  };
}

async function snapshotCheckout(checkoutSessionId: string): Promise<LegacyCheckoutSnapshot> {
  const session = await getStripeClient().checkout.sessions.retrieve(checkoutSessionId, {
    expand: ['payment_intent.latest_charge'],
  });
  return checkoutSnapshot(session);
}

async function expireCheckoutSession(checkoutSessionId: string): Promise<LegacyCheckoutSnapshot> {
  const stripe = getStripeClient();
  try {
    await stripe.checkout.sessions.expire(checkoutSessionId);
  } catch (error) {
    logger.warn({
      type: 'meter.ondemand.legacy_checkout_expire_skipped',
      message: error instanceof Error ? error.message : 'expire skipped',
    });
  }
  return snapshotCheckout(checkoutSessionId);
}

async function reconcilePaidLegacyCheckout(
  payment: MeterPayment,
  bookingId: string
): Promise<MeterPayment> {
  if (!payment.stripeCheckoutSessionId) return payment;
  try {
    const snapshot = await snapshotCheckout(payment.stripeCheckoutSessionId);
    if (
      assessLegacyCheckout({
        expectedBookingId: bookingId,
        expectedAmountCents: payment.amountCents,
        snapshot,
      }) !== 'paid'
    ) {
      return payment;
    }
    const updated = await updateMeterPayment(payment.id, {
      status: MeterPaymentStatus.PAID,
      stripePaymentIntentId: snapshot.paymentIntent?.id ?? payment.stripePaymentIntentId,
      receiptUrl: snapshot.paymentIntent?.receiptUrl ?? payment.receiptUrl,
      paidAt: payment.paidAt ?? new Date(),
      hostedUrl: null,
    });
    if (!updated) return payment;
    await publishOnDemandMeterPayment(updated);
    return updated;
  } catch (error) {
    logger.warn({
      type: 'meter.ondemand.legacy_checkout_reconcile_failed',
      bookingId,
      message: error instanceof Error ? error.message : 'reconcile failed',
    });
    return payment;
  }
}

const paymentIntentReconcileState = new Map<string, PaymentIntentReconcileState>();

export function resetOnDemandPaymentIntentReconcileForTests(): void {
  paymentIntentReconcileState.clear();
}

async function snapshotPaymentIntent(paymentIntentId: string): Promise<StoredPaymentIntentSnapshot> {
  const intent = await getStripeClient().paymentIntents.retrieve(paymentIntentId, {
    expand: ['latest_charge'],
  });
  const charge = intent.latest_charge;
  const receiptUrl = charge && typeof charge === 'object' ? charge.receipt_url ?? null : null;
  return {
    id: intent.id,
    status: intent.status,
    livemode: intent.livemode,
    amount: intent.amount,
    currency: intent.currency,
    receiptUrl,
    purpose: intent.metadata?.purpose ?? null,
    bookingId: intent.metadata?.bookingId ?? null,
    meterPaymentId: intent.metadata?.meterPaymentId ?? null,
    fareRecordId: intent.metadata?.fareRecordId ?? null,
    lastPaymentError: Boolean(intent.last_payment_error),
  };
}

export async function commitOnDemandPaymentIntentSettlement(
  paymentId: string,
  verdict: PaymentIntentReconcileCommit
): Promise<MeterPayment | null> {
  const current = await findMeterPaymentById(paymentId);
  if (!current || current.subjectType !== 'on_demand' || !current.bookingId) return current;
  if (current.settlementMode !== MeterSettlementMode.STRIPE_TEST) return current;
  const decision = meterPaymentIntentWebhookDecision({
    action: verdict.action,
    amount: verdict.amount,
    currency: verdict.currency,
    expectedAmountCents: current.amountCents,
    expectedCurrency: current.currency,
    currentStatus: current.status as MeterPaymentStatusType,
  });
  if (!decision.accept) {
    if (decision.status === current.status) return current;
    const updated = await updateMeterPayment(current.id, {
      status: decision.status,
      failureCode: decision.failureCode,
    });
    if (updated) await publishOnDemandMeterPayment(updated);
    return updated;
  }
  if (decision.status === current.status && !decision.markPaid) return current;
  const updated = await updateMeterPayment(current.id, {
    status: decision.status,
    stripePaymentIntentId: verdict.paymentIntentId,
    receiptUrl: decision.markPaid ? verdict.receiptUrl ?? current.receiptUrl : current.receiptUrl,
    paidAt: decision.markPaid ? current.paidAt ?? new Date() : current.paidAt,
    failureCode: decision.failureCode,
  });
  if (updated) await publishOnDemandMeterPayment(updated);
  return updated;
}

async function reconcileStoredIntentRow(
  payment: MeterPayment,
  bookingId: string,
  expectedFareCents: number
): Promise<MeterPayment> {
  if (!payment.stripePaymentIntentId || !payment.fareRecordId) return payment;
  return runOnDemandFarePaymentLock(payment.fareRecordId, async () => {
    const fresh = await findMeterPaymentById(payment.id);
    if (!fresh) return payment;
    const state = paymentIntentReconcileState.get(fresh.id) ?? { lastAttemptMs: null };
    paymentIntentReconcileState.set(fresh.id, state);
    try {
      await reconcileStoredOnDemandPaymentIntent({
        payment: toStored(fresh),
        bookingId,
        expectedFareCents,
        nowMs: Date.now(),
        state,
        retrievePaymentIntent: snapshotPaymentIntent,
        commit: async (verdict) => {
          const saved = await commitOnDemandPaymentIntentSettlement(fresh.id, verdict);
          return toStored(saved ?? fresh);
        },
      });
    } catch (error) {
      logger.warn({
        type: 'meter.ondemand.payment_intent_reconcile_failed',
        bookingId,
        message: error instanceof Error ? error.message : 'reconcile failed',
      });
    }
    return (await findMeterPaymentById(fresh.id)) ?? fresh;
  });
}

async function expireStripeTestCheckout(checkoutSessionId: string): Promise<'expired' | 'paid'> {
  const stripe = getStripeClient();
  try {
    const session = await stripe.checkout.sessions.expire(checkoutSessionId);
    return session.payment_status === 'paid' ? 'paid' : 'expired';
  } catch (error) {
    const retrieved = await stripe.checkout.sessions.retrieve(checkoutSessionId);
    if (retrieved.payment_status === 'paid') return 'paid';
    if (retrieved.status === 'expired') return 'expired';
    const message = error instanceof Error ? error.message : 'expire failed';
    throw new MeterError('METER_CHECKOUT_FAILED', message, 502);
  }
}

export async function publishOnDemandMeterPayment(payment: MeterPayment): Promise<void> {
  if (!payment.bookingId) return;
  const booking = await findBookingById(payment.bookingId);
  if (!booking) return;
  if (booking.paymentStatus !== payment.status) {
    await updateBooking(booking.id, { paymentStatus: payment.status });
  }
  const session = await findMeterByBooking(booking.id);
  const view = toOnDemandMeterPaymentView({
    bookingId: booking.id,
    rideStatus: booking.status,
    completedAt: booking.completedAt?.toISOString() ?? null,
    meterSessionId: session?.id ?? payment.meterSessionId,
    payment: toStored(payment),
  });
  await emitBookingMeterPayment({
    customerId: booking.customerId,
    driverId: booking.assignedDriverId,
    payload: view,
  });
}

async function insertPendingPayment(input: {
  bookingId: string;
  sessionId: string;
  fareId: string;
  amountCents: number;
  currency: string;
}): Promise<MeterPayment> {
  try {
    return await insertMeterPayment({
      subjectType: 'on_demand',
      bookingId: input.bookingId,
      meterSessionId: input.sessionId,
      fareRecordId: input.fareId,
      currency: input.currency.toUpperCase(),
      amountCents: input.amountCents,
      status: MeterPaymentStatus.PENDING,
      provider: 'stripe',
      idempotencyKey: `meter_checkout:${input.fareId}`,
      settlementMode: MeterSettlementMode.STRIPE_TEST,
      testOnly: true,
      stripeLivemode: false,
      fareClassification: TEST_ONLY_UNAPPROVED_TARIFF,
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await findMeterPaymentByFare(input.fareId);
    if (!existing) throw error;
    return existing;
  }
}

/**
 * After a metered ride completes, release any uncaptured quote authorization
 * and store a pending test payment for the finalized meter fare.
 * An already-captured quote is left untouched and is not charged a second time.
 */
export async function ensureOnDemandMeterSettlement(
  bookingId: string,
  driverId: string
): Promise<MeterPayment | null> {
  const booking = await findBookingById(bookingId);
  if (!booking || booking.assignedDriverId !== driverId) return null;
  const session = await findMeterByBooking(bookingId);
  if (
    onDemandCompletionSettlement({
      hasMeterSession: Boolean(session),
      meterVoided: session?.status === 'voided',
      quoteAlreadyCaptured: false,
    }) !== 'release_quote_and_meter_test'
  ) {
    return null;
  }
  if (!session) return null;

  let fare = await findFareBySession(session.id);
  if (session.status !== 'finalized' && session.status !== 'pending') {
    const finalized = await finalizeMeterSession(session.id, driverId);
    fare = finalized.fare;
  }
  if (!fare || !Number.isInteger(fare.totalCents) || fare.totalCents <= 0) return null;

  let quoteAlreadyCaptured = false;
  try {
    const release = await releaseCardPaymentAuthorization(bookingId);
    quoteAlreadyCaptured = release.alreadyCaptured;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'release failed';
    logger.warn({
      type: 'meter.ondemand.quote_release_failed',
      bookingId,
      message,
    });
  }
  if (
    onDemandCompletionSettlement({
      hasMeterSession: true,
      meterVoided: false,
      quoteAlreadyCaptured,
    }) === 'leave_historical_quote'
  ) {
    logger.info({
      type: 'meter.ondemand.quote_already_captured',
      bookingId,
    });
    return null;
  }

  const payment = await insertPendingPayment({
    bookingId,
    sessionId: session.id,
    fareId: fare.id,
    amountCents: fare.totalCents,
    currency: fare.rateSnapshot.currency,
  });
  await publishOnDemandMeterPayment(payment);
  return payment;
}

/**
 * Classified metered rides with no payable meter fare stay unpaid.
 * This does not capture the quote and does not write a cash quote ledger.
 */
export async function markMeterSettlementUnresolved(bookingId: string): Promise<void> {
  const booking = await findBookingById(bookingId);
  if (!booking || booking.billingMode !== 'metered_post_trip') return;
  if (
    booking.paymentStatus === 'paid' ||
    booking.paymentStatus === 'refunded' ||
    booking.paymentStatus === 'meter_unresolved'
  ) {
    return;
  }
  const meterPayment = await findMeterPaymentByBooking(bookingId);
  if (meterPayment) return;
  const quote = await findBookingPaymentByBookingId(bookingId);
  if (quote?.capturedAt || quote?.status === 'succeeded') return;

  await updateBooking(bookingId, { paymentStatus: 'meter_unresolved' });
  await insertBookingEvent({
    bookingId,
    actorType: 'system',
    eventType: 'meter_settlement_unresolved',
    payload: { reason: 'meter_fare_missing', chargingEnabled: false },
  });
}

async function requireOwnedCompletedBooking(bookingId: string, customerId: string) {
  const booking = await findBookingById(bookingId);
  if (!booking || booking.customerId !== customerId) {
    throw new MeterError('BOOKING_NOT_FOUND', 'Booking not found.', 404);
  }
  return booking;
}

export async function readPassengerOnDemandMeterPayment(
  bookingId: string,
  customerId: string
): Promise<OnDemandMeterPaymentView> {
  const booking = await requireOwnedCompletedBooking(bookingId, customerId);
  const session = await findMeterByBooking(bookingId);
  let payment = await findMeterPaymentByBooking(bookingId);
  if (payment?.status === MeterPaymentStatus.CHECKOUT_OPEN && payment.stripeCheckoutSessionId) {
    payment = await reconcilePaidLegacyCheckout(payment, booking.id);
  } else if (payment?.stripePaymentIntentId && session) {
    const fare = await findFareBySession(session.id);
    if (fare && fare.id === payment.fareRecordId && fare.totalCents === payment.amountCents) {
      payment = await reconcileStoredIntentRow(payment, booking.id, fare.totalCents);
    }
  }
  return toOnDemandMeterPaymentView({
    bookingId: booking.id,
    rideStatus: booking.status,
    completedAt: booking.completedAt?.toISOString() ?? null,
    meterSessionId: session?.id ?? null,
    payment: payment ? toStored(payment) : null,
  });
}

export async function openPassengerOnDemandMeterCheckout(bookingId: string, customerId: string) {
  const booking = await requireOwnedCompletedBooking(bookingId, customerId);
  const session = await findMeterByBooking(bookingId);
  if (!session) throw new MeterError('METER_NOT_FOUND', 'Meter session not found.', 404);
  const fare = await findFareBySession(session.id);
  if (!fare) throw new MeterError('METER_FARE_MISSING', 'Final fare record is missing.', 409);
  const release = await releaseCardPaymentAuthorization(bookingId);
  if (release.alreadyCaptured) {
    throw new MeterError(
      'QUOTE_ALREADY_CAPTURED',
      'The original quote was already captured. A second meter charge was not created.',
      409
    );
  }
  let payment: MeterPayment | null = await findMeterPaymentByBooking(bookingId);
  if (!payment && booking.assignedDriverId) {
    payment = await ensureOnDemandMeterSettlement(bookingId, booking.assignedDriverId);
  }
  if (!payment) {
    throw new MeterError('METER_PAYMENT_MISSING', 'The completed ride has no pending meter payment.', 409);
  }
  const saved = await openOnDemandTestCheckout({
    actorCustomerId: customerId,
    booking: { id: booking.id, customerId: booking.customerId, status: booking.status },
    session: { id: session.id, status: session.status },
    fare: {
      id: fare.id,
      sessionId: session.id,
      totalCents: fare.totalCents,
      currency: fare.rateSnapshot.currency,
      billable: fare.billable,
      chargingEnabled: fare.chargingEnabled,
      acceptedDistanceMillimeters: fare.acceptedDistanceMillimeters,
      waitingSeconds: fare.waitingSeconds,
      waitingChargeCents: fare.waitingChargeCents,
      rateSnapshot: fare.rateSnapshot as RateSnapshot,
    },
    existing: toStored(payment),
    config: readOnDemandStripeTestConfig(),
    nowMs: Date.now(),
    store: {
      findByFare: async (fareId) => {
        const row = await findMeterPaymentByFare(fareId);
        return row ? toStored(row) : null;
      },
      insert: async () => {
        throw new MeterError('METER_PAYMENT_MISSING', 'Meter payment must already exist.', 409);
      },
      update: async (id, patch) => {
        const values: Parameters<typeof updateMeterPayment>[1] = {};
        if (patch.status !== undefined) values.status = patch.status;
        if (patch.hostedUrl !== undefined) values.hostedUrl = patch.hostedUrl;
        if (patch.stripeCheckoutSessionId !== undefined) {
          values.stripeCheckoutSessionId = patch.stripeCheckoutSessionId;
        }
        if (patch.stripePaymentIntentId !== undefined) {
          values.stripePaymentIntentId = patch.stripePaymentIntentId;
        }
        if (patch.receiptUrl !== undefined) values.receiptUrl = patch.receiptUrl;
        if (patch.failureCode !== undefined) values.failureCode = patch.failureCode;
        if (patch.expiresAtMs !== undefined) {
          values.expiresAt = patch.expiresAtMs == null ? null : new Date(patch.expiresAtMs);
        }
        if (patch.paidAtMs !== undefined) {
          values.paidAt = patch.paidAtMs == null ? null : new Date(patch.paidAtMs);
        }
        const updated = await updateMeterPayment(id, values);
        if (!updated) throw new MeterError('METER_PAYMENT_MISSING', 'Meter payment not found.', 404);
        return toStored(updated);
      },
    },
    createCheckout: createStripeHostedCheckout,
    expireCheckout: expireStripeTestCheckout,
  });
  const row = await findMeterPaymentByFare(fare.id);
  if (row) await publishOnDemandMeterPayment(row);
  const gate = evaluateOnDemandStripeTestConfig(readOnDemandStripeTestConfig());
  return {
    ...toOnDemandMeterPaymentView({
      bookingId: booking.id,
      rideStatus: booking.status,
      completedAt: booking.completedAt?.toISOString() ?? null,
      meterSessionId: session.id,
      payment: saved,
    }),
    checkoutReady: gate.action === 'ready',
  };
}

export async function openPassengerOnDemandMeterPaymentIntent(
  bookingId: string,
  customerId: string
) {
  const booking = await requireOwnedCompletedBooking(bookingId, customerId);
  const session = await findMeterByBooking(bookingId);
  if (!session) throw new MeterError('METER_NOT_FOUND', 'Meter session not found.', 404);
  const fare = await findFareBySession(session.id);
  if (!fare) throw new MeterError('METER_FARE_MISSING', 'Final fare record is missing.', 409);
  const release = await releaseCardPaymentAuthorization(bookingId);
  if (release.alreadyCaptured) {
    throw new MeterError(
      'QUOTE_ALREADY_CAPTURED',
      'The original quote was already captured. A second meter charge was not created.',
      409
    );
  }
  let payment: MeterPayment | null = await findMeterPaymentByBooking(bookingId);
  if (!payment && booking.assignedDriverId) {
    payment = await ensureOnDemandMeterSettlement(bookingId, booking.assignedDriverId);
  }
  if (!payment) {
    throw new MeterError('METER_PAYMENT_MISSING', 'The completed ride has no pending meter payment.', 409);
  }
  const stripe = getStripeClient();
  const saved = await openOnDemandTestPaymentIntent({
    actorCustomerId: customerId,
    booking: { id: booking.id, customerId: booking.customerId, status: booking.status },
    session: { id: session.id, status: session.status },
    fare: {
      id: fare.id,
      sessionId: session.id,
      totalCents: fare.totalCents,
      currency: fare.rateSnapshot.currency,
      billable: fare.billable,
      chargingEnabled: fare.chargingEnabled,
      acceptedDistanceMillimeters: fare.acceptedDistanceMillimeters,
      waitingSeconds: fare.waitingSeconds,
      waitingChargeCents: fare.waitingChargeCents,
      rateSnapshot: fare.rateSnapshot as RateSnapshot,
    },
    existing: toStored(payment),
    config: readOnDemandStripeTestConfig(),
    publishableKey: getStripePublishableKey() ?? null,
    store: {
      findByFare: async (fareId) => {
        const row = await findMeterPaymentByFare(fareId);
        return row ? toStored(row) : null;
      },
      insert: async () => {
        throw new MeterError('METER_PAYMENT_MISSING', 'Meter payment must already exist.', 409);
      },
      update: async (id, patch) => {
        const values: Parameters<typeof updateMeterPayment>[1] = {};
        if (patch.status !== undefined) values.status = patch.status;
        if (patch.stripePaymentIntentId !== undefined) {
          values.stripePaymentIntentId = patch.stripePaymentIntentId;
        }
        if (patch.hostedUrl !== undefined) values.hostedUrl = patch.hostedUrl;
        if (patch.receiptUrl !== undefined) values.receiptUrl = patch.receiptUrl;
        if (patch.paidAtMs !== undefined) {
          values.paidAt = patch.paidAtMs == null ? null : new Date(patch.paidAtMs);
        }
        if (patch.failureCode !== undefined) values.failureCode = patch.failureCode;
        const updated = await updateMeterPayment(id, values);
        if (!updated) throw new MeterError('METER_PAYMENT_MISSING', 'Meter payment not found.', 404);
        return toStored(updated);
      },
    },
    retrieveCheckout: snapshotCheckout,
    expireCheckout: expireCheckoutSession,
    retrievePaymentIntent: async (paymentIntentId) => {
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ['latest_charge'],
      });
      const charge = intent.latest_charge;
      const receiptUrl = charge && typeof charge === 'object' ? charge.receipt_url ?? null : null;
      return {
        id: intent.id,
        clientSecret: intent.client_secret,
        amount: intent.amount,
        currency: intent.currency,
        status: intent.status,
        livemode: intent.livemode,
        receiptUrl,
        purpose: intent.metadata?.purpose ?? null,
        bookingId: intent.metadata?.bookingId ?? null,
        meterPaymentId: intent.metadata?.meterPaymentId ?? null,
        fareRecordId: intent.metadata?.fareRecordId ?? null,
      };
    },
    createPaymentIntent: async (request) => {
      const intent = await stripe.paymentIntents.create(
        {
          amount: request.amountCents,
          currency: request.currency,
          capture_method: 'automatic',
          payment_method_types: ['card'],
          metadata: request.metadata,
        },
        { idempotencyKey: request.idempotencyKey }
      );
      return {
        id: intent.id,
        clientSecret: intent.client_secret,
        amount: intent.amount,
        currency: intent.currency,
        status: intent.status,
        livemode: intent.livemode,
      };
    },
  });
  const row = await findMeterPaymentByFare(fare.id);
  if (row) await publishOnDemandMeterPayment(row);
  return {
    bookingId: booking.id,
    paymentIntentClientSecret: saved.paymentIntentClientSecret,
    paymentIntentId: saved.paymentIntentId,
    publishableKey: saved.publishableKey,
    finalFareCents: saved.finalFareCents,
    currency: saved.currency,
    paymentStatus: saved.paymentStatus,
    testMode: saved.testMode,
    paymentVersion: saved.paymentVersion,
    productionCharge: false as const,
  };
}

export async function readPassengerOnDemandMeterReceipt(bookingId: string, customerId: string) {
  const view = await readPassengerOnDemandMeterPayment(bookingId, customerId);
  const session = await findMeterByBooking(bookingId);
  const fare = session ? await findFareBySession(session.id) : null;
  return {
    ...view,
    fare: fare
      ? {
          flagDropCents: fare.flagDropCents,
          distanceChargeCents: fare.distanceChargeCents,
          waitingChargeCents: fare.waitingChargeCents,
          totalCents: fare.totalCents,
          currency: fare.rateSnapshot.currency,
        }
      : null,
  };
}

export async function readLatestUnpaidOnDemandMeterRide(
  customerId: string
): Promise<OnDemandMeterPaymentView | null> {
  const row = await findLatestUnpaidOnDemandMeterPayment(customerId);
  if (!row?.payment.bookingId) return null;
  const booking = await findBookingById(row.payment.bookingId);
  if (!booking || booking.customerId !== customerId) return null;
  return toOnDemandMeterPaymentView({
    bookingId: booking.id,
    rideStatus: booking.status,
    completedAt: booking.completedAt?.toISOString() ?? null,
    meterSessionId: row.payment.meterSessionId,
    payment: toStored(row.payment),
  });
}

export async function meterPaymentsForBookings(bookingIds: string[]) {
  return findMeterPaymentsByBookingIds(bookingIds);
}
