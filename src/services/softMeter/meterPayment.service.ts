import type Stripe from 'stripe';
import {
  METER_CHECKOUT_PURPOSE,
  METERED_CHARGING_RELEASED,
  MeterPaymentStatus,
  MeterSettlementMode,
  type MeterPaymentStatusType,
  type MeterSettlementModeType,
} from '../../constants/softMeter';
import { logger } from '../../middleware/logger';
import { findFareBySession } from '../../repositories/meterSession.repository';
import {
  findMeterPaymentByCheckout,
  findMeterPaymentByFare,
  findMeterPaymentById,
  findMeterPaymentByIdempotency,
  findMeterPaymentByPaymentIntent,
  insertMeterPayment,
  updateMeterPayment,
} from '../../repositories/meterPayment.repository';
import type { MeterPayment } from '../../db/schema/meter_payments';
import { findWalkUpById, updateWalkUp } from '../../repositories/walkUp.repository';
import { getStripeClient } from '../stripe.service';
import { MeterError } from './errors';
import { emitWalkUpPayment } from './meterNotify.service';
import {
  applyPaymentSignal,
  interpretCheckoutEvent,
  interpretOnDemandPaymentIntentEvent,
  interpretRefundEvent,
} from './paymentState';
import type { RateSnapshot } from './rules';
import {
  evaluateWalkUpStripeTestConfig,
  openWalkUpTestCheckout,
  readWalkUpStripeTestConfig,
  toWalkUpPaymentStatus,
  verifyTestCheckoutWebhook,
  type StoredTestPayment,
} from './testPayment';

export interface ChargeableFare {
  id: string;
  sessionId: string;
  totalCents: number;
  currency: string;
  billable: boolean;
  blockedReasons: string[];
}

export interface HostedPaymentDeps {
  createCheckout: (input: {
    amountCents: number;
    currency: string;
    idempotencyKey: string;
    metadata: Record<string, string>;
    subjectId: string;
  }) => Promise<{ id: string; url: string }>;
}

function checkoutIdempotencyKey(fareRecordId: string): string {
  return `meter_checkout:${fareRecordId}`;
}

export async function createStripeHostedCheckout(input: {
  amountCents: number;
  currency: string;
  idempotencyKey: string;
  metadata: Record<string, string>;
  subjectId: string;
  expiresAtUnix?: number;
  productName?: string;
}): Promise<{ id: string; url: string }> {
  const successUrl = process.env.METER_CHECKOUT_SUCCESS_URL;
  const cancelUrl = process.env.METER_CHECKOUT_CANCEL_URL;
  if (!successUrl || !cancelUrl) {
    throw new MeterError(
      'METER_CHECKOUT_URLS_MISSING',
      'METER_CHECKOUT_SUCCESS_URL and METER_CHECKOUT_CANCEL_URL are required before a hosted payment can be created.',
      503
    );
  }
  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.create(
    {
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: input.subjectId,
      metadata: input.metadata,
      ...(input.expiresAtUnix ? { expires_at: input.expiresAtUnix } : {}),
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: input.currency.toLowerCase(),
            unit_amount: input.amountCents,
            product_data: { name: input.productName ?? 'DriveWize trip' },
          },
        },
      ],
    },
    { idempotencyKey: input.idempotencyKey }
  );
  if (!session.url) {
    throw new MeterError('METER_CHECKOUT_FAILED', 'Stripe did not return a hosted payment URL.', 502);
  }
  return { id: session.id, url: session.url };
}

/**
 * Refuses Stripe Checkout unless the process latch and the fare are both billable.
 * The latch is false in this release, so this records a not-billable reconciliation
 * row and does not call Stripe.
 */
export async function requestHostedMeterPayment(input: {
  subjectType: 'walk_up' | 'on_demand';
  walkUpTripId?: string | null;
  bookingId?: string | null;
  fare: ChargeableFare;
  currency: string;
  deps?: HostedPaymentDeps;
}) {
  const key = checkoutIdempotencyKey(input.fare.id);
  const existing = await findMeterPaymentByIdempotency(key);
  if (existing?.status === MeterPaymentStatus.CHECKOUT_OPEN && existing.hostedUrl) {
    return { payment: existing, idempotent: true, hostedUrl: existing.hostedUrl };
  }
  if (existing?.status === MeterPaymentStatus.PAID) {
    return { payment: existing, idempotent: true, hostedUrl: existing.hostedUrl };
  }

  const chargeable = METERED_CHARGING_RELEASED && input.fare.billable;
  if (!chargeable) {
    const payment =
      existing ??
      (await insertMeterPayment({
        subjectType: input.subjectType,
        walkUpTripId: input.walkUpTripId ?? null,
        bookingId: input.bookingId ?? null,
        meterSessionId: input.fare.sessionId,
        fareRecordId: input.fare.id,
        currency: input.currency,
        amountCents: input.fare.totalCents,
        status: MeterPaymentStatus.NOT_BILLABLE,
        provider: 'stripe',
        idempotencyKey: key,
        failureCode: 'METER_CHARGING_DISABLED',
        failureMessage: 'Metered charging is not released.',
      }));
    if (input.walkUpTripId) {
      await updateWalkUp(input.walkUpTripId, { paymentStatus: MeterPaymentStatus.NOT_BILLABLE });
    }
    throw new MeterError(
      'METER_CHARGING_DISABLED',
      'The meter fare is provisional and cannot be charged until approved rate rules are released.',
      409,
      {
        paymentId: payment.id,
        amountCents: input.fare.totalCents,
        currency: input.currency,
        blockedReasons: input.fare.blockedReasons,
      }
    );
  }

  const deps = input.deps ?? { createCheckout: createStripeHostedCheckout };
  const metadata: Record<string, string> = {
    purpose:
      input.subjectType === 'walk_up'
        ? METER_CHECKOUT_PURPOSE.WALK_UP
        : METER_CHECKOUT_PURPOSE.ON_DEMAND,
    meterSessionId: input.fare.sessionId,
    fareRecordId: input.fare.id,
  };
  if (input.walkUpTripId) metadata.walkUpTripId = input.walkUpTripId;
  if (input.bookingId) metadata.bookingId = input.bookingId;
  const checkout = await deps.createCheckout({
    amountCents: input.fare.totalCents,
    currency: input.currency,
    idempotencyKey: key,
    metadata,
    subjectId: input.walkUpTripId ?? input.bookingId ?? input.fare.id,
  });
  const transition = applyPaymentSignal(MeterPaymentStatus.PENDING, { type: 'checkout_created' });
  const payment = await insertMeterPayment({
    subjectType: input.subjectType,
    walkUpTripId: input.walkUpTripId ?? null,
    bookingId: input.bookingId ?? null,
    meterSessionId: input.fare.sessionId,
    fareRecordId: input.fare.id,
    currency: input.currency,
    amountCents: input.fare.totalCents,
    status: transition.status,
    provider: 'stripe',
    stripeCheckoutSessionId: checkout.id,
    hostedUrl: checkout.url,
    idempotencyKey: key,
  });
  return { payment, idempotent: false, hostedUrl: checkout.url };
}

function toStoredPayment(row: MeterPayment): StoredTestPayment {
  return {
    id: row.id,
    status: row.status as MeterPaymentStatusType,
    hostedUrl: row.hostedUrl,
    stripeCheckoutSessionId: row.stripeCheckoutSessionId,
    stripePaymentIntentId: row.stripePaymentIntentId,
    receiptUrl: row.receiptUrl,
    amountCents: row.amountCents,
    currency: row.currency,
    settlementMode: row.settlementMode as MeterSettlementModeType,
    testOnly: row.testOnly,
    fareClassification: row.fareClassification,
    expiresAtMs: row.expiresAt ? row.expiresAt.getTime() : null,
    fareRecordId: row.fareRecordId,
    idempotencyKey: row.idempotencyKey,
    failureCode: row.failureCode,
    paidAtMs: row.paidAt ? row.paidAt.getTime() : null,
    createdAtMs: row.createdAt.getTime(),
    updatedAtMs: row.updatedAt.getTime(),
  };
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

export async function requestWalkUpPaymentLink(tripId: string, driverId: string) {
  const trip = await findWalkUpById(tripId);
  if (!trip || trip.driverId !== driverId) {
    throw new MeterError('WALK_UP_NOT_FOUND', 'Walk-up trip not found.', 404);
  }
  const { findMeterByWalkUp } = await import('../../repositories/meterSession.repository');
  const session = await findMeterByWalkUp(trip.id);
  if (!session || session.status !== 'finalized') {
    throw new MeterError('METER_NOT_FINALIZED', 'Finalize the meter before requesting payment.', 409);
  }
  const fare = await findFareBySession(session.id);
  if (!fare) throw new MeterError('METER_FARE_MISSING', 'Final fare record is missing.', 500);
  const gate = evaluateWalkUpStripeTestConfig(readWalkUpStripeTestConfig());
  if (gate.action === 'disabled') {
    return requestHostedMeterPayment({
      subjectType: 'walk_up',
      walkUpTripId: trip.id,
      fare: {
        id: fare.id,
        sessionId: session.id,
        totalCents: fare.totalCents,
        currency: trip.currency,
        billable: fare.billable,
        blockedReasons: fare.blockedReasons ?? [],
      },
      currency: trip.currency,
    });
  }
  if (gate.action === 'reject') {
    throw new MeterError(gate.code, gate.message, gate.status);
  }
  const result = await openWalkUpTestCheckout({
    actorDriverId: driverId,
    trip: { id: trip.id, driverId: trip.driverId, currency: trip.currency, status: trip.status },
    session: { id: session.id, status: session.status },
    fare: {
      id: fare.id,
      sessionId: session.id,
      totalCents: fare.totalCents,
      currency: trip.currency,
      billable: fare.billable,
      chargingEnabled: fare.chargingEnabled,
      acceptedDistanceMillimeters: fare.acceptedDistanceMillimeters,
      waitingSeconds: fare.waitingSeconds,
      waitingChargeCents: fare.waitingChargeCents,
      rateSnapshot: fare.rateSnapshot as RateSnapshot,
    },
    config: readWalkUpStripeTestConfig(),
    nowMs: Date.now(),
    store: {
      findByFare: async (fareId) => {
        const row = await findMeterPaymentByFare(fareId);
        return row ? toStoredPayment(row) : null;
      },
      insert: async (row) => {
        const saved = await insertMeterPayment({
          subjectType: 'walk_up',
          walkUpTripId: trip.id,
          meterSessionId: session.id,
          fareRecordId: fare.id,
          currency: 'USD',
          amountCents: row.amountCents,
          status: row.status,
          provider: 'stripe',
          stripeCheckoutSessionId: row.stripeCheckoutSessionId,
          hostedUrl: row.hostedUrl,
          idempotencyKey: row.idempotencyKey,
          settlementMode: MeterSettlementMode.STRIPE_TEST,
          testOnly: true,
          stripeLivemode: false,
          expiresAt: row.expiresAtMs == null ? null : new Date(row.expiresAtMs),
          fareClassification: row.fareClassification,
        });
        return toStoredPayment(saved);
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
        if (patch.amountCents !== undefined) values.amountCents = patch.amountCents;
        if (patch.currency !== undefined) values.currency = patch.currency;
        if (patch.settlementMode !== undefined) values.settlementMode = patch.settlementMode;
        if (patch.testOnly !== undefined) values.testOnly = patch.testOnly;
        if (patch.fareClassification !== undefined) values.fareClassification = patch.fareClassification;
        if (patch.failureCode !== undefined) values.failureCode = patch.failureCode;
        if (patch.expiresAtMs !== undefined) {
          values.expiresAt = patch.expiresAtMs == null ? null : new Date(patch.expiresAtMs);
        }
        if (patch.paidAtMs !== undefined) {
          values.paidAt = patch.paidAtMs == null ? null : new Date(patch.paidAtMs);
        }
        values.stripeLivemode = false;
        const saved = await updateMeterPayment(id, values);
        if (!saved) throw new MeterError('METER_PAYMENT_NOT_READY', 'Meter payment could not be saved.', 500);
        return toStoredPayment(saved);
      },
    },
    createCheckout: (request) => createStripeHostedCheckout(request),
    expireCheckout: expireStripeTestCheckout,
  });
  await updateWalkUp(trip.id, { paymentStatus: result.paymentStatus });
  if (!result.idempotent) {
    await emitWalkUpPayment(trip.driverId, {
      walkUpTripId: trip.id,
      paymentStatus: result.paymentStatus,
      paid: result.paymentStatus === MeterPaymentStatus.PAID,
      testMode: true,
      testOnly: true,
      hostedUrl: result.hostedUrl,
      qrPayload: result.qrPayload,
      amountCents: result.amountCents,
      currency: result.currency,
      receiptUrl: null,
    });
  }
  return result;
}

export async function readWalkUpPayment(tripId: string, driverId: string) {
  const trip = await findWalkUpById(tripId);
  if (!trip || trip.driverId !== driverId) {
    throw new MeterError('WALK_UP_NOT_FOUND', 'Walk-up trip not found.', 404);
  }
  const { findMeterByWalkUp } = await import('../../repositories/meterSession.repository');
  const session = await findMeterByWalkUp(trip.id);
  const fare = session ? await findFareBySession(session.id) : null;
  const payment = fare ? await findMeterPaymentByFare(fare.id) : null;
  if (payment) {
    applyPaymentSignal(payment.status as MeterPaymentStatusType, { type: 'customer_returned' });
  }
  return toWalkUpPaymentStatus({
    tripId: trip.id,
    tripStatus: trip.status,
    currency: trip.currency,
    payment: payment ? toStoredPayment(payment) : null,
    tripPaymentStatus: trip.paymentStatus,
    nowMs: Date.now(),
    fare: fare
      ? {
          id: fare.id,
          totalCents: fare.totalCents,
          billable: false,
          flagDropCents: fare.flagDropCents,
          distanceChargeCents: fare.distanceChargeCents,
          waitingChargeCents: fare.waitingChargeCents,
          blockedReasons: fare.blockedReasons ?? [],
          acceptedDistanceMillimeters: fare.acceptedDistanceMillimeters,
          createdAt: fare.createdAt.toISOString(),
        }
      : null,
  });
}

export async function readWalkUpReceipt(tripId: string, driverId: string) {
  const payment = await readWalkUpPayment(tripId, driverId);
  const { findMeterByWalkUp } = await import('../../repositories/meterSession.repository');
  const session = await findMeterByWalkUp(tripId);
  const fare = session ? await findFareBySession(session.id) : null;
  return {
    ...payment,
    fare: fare
      ? {
          id: fare.id,
          flagDropCents: fare.flagDropCents,
          distanceChargeCents: fare.distanceChargeCents,
          waitingChargeCents: fare.waitingChargeCents,
          totalCents: fare.totalCents,
          billable: fare.billable,
          blockedReasons: fare.blockedReasons,
          acceptedDistanceMillimeters: fare.acceptedDistanceMillimeters,
          rateSnapshot: fare.rateSnapshot,
          createdAt: fare.createdAt.toISOString(),
        }
      : null,
  };
}

async function publishWalkUpPayment(walkUpTripId: string, status: string, hostedUrl: string | null, receiptUrl: string | null, testOnly: boolean) {
  const trip = await findWalkUpById(walkUpTripId);
  if (!trip) return;
  await updateWalkUp(walkUpTripId, { paymentStatus: status });
  await emitWalkUpPayment(trip.driverId, {
    walkUpTripId: trip.id,
    paymentStatus: status,
    paid: status === MeterPaymentStatus.PAID,
    testMode: testOnly,
    testOnly,
    hostedUrl: status === MeterPaymentStatus.CHECKOUT_OPEN ? hostedUrl : null,
    qrPayload: status === MeterPaymentStatus.CHECKOUT_OPEN ? hostedUrl : null,
    receiptUrl,
  });
}

async function handleTestRefund(event: Stripe.Event): Promise<void> {
  if (event.livemode === true) {
    logger.info({ type: 'meter.checkout.live_mode_rejected', stripeEventId: event.id });
    return;
  }
  const interpreted = interpretRefundEvent(event);
  if (interpreted.action !== 'refunded' || !interpreted.paymentIntentId) return;
  const payment = await findMeterPaymentByPaymentIntent(interpreted.paymentIntentId);
  if (!payment || payment.settlementMode !== MeterSettlementMode.STRIPE_TEST) return;
  const next = applyPaymentSignal(payment.status as MeterPaymentStatusType, { type: 'webhook_refunded' });
  if (!next.changed) return;
  const updated = await updateMeterPayment(payment.id, { status: next.status });
  if (payment.walkUpTripId && updated) {
    await publishWalkUpPayment(payment.walkUpTripId, updated.status, updated.hostedUrl, updated.receiptUrl, true);
  }
  if (payment.bookingId && updated) {
    const { publishOnDemandMeterPayment } = await import('./onDemandMeterPayment.service');
    await publishOnDemandMeterPayment(updated);
  }
}

async function handleOnDemandPaymentIntentWebhook(event: Stripe.Event): Promise<void> {
  if (event.livemode === true) {
    logger.info({ type: 'meter.payment_intent.live_mode_rejected', stripeEventId: event.id });
    return;
  }
  const interpreted = interpretOnDemandPaymentIntentEvent(event);
  if (interpreted.action === 'ignore' || interpreted.action === 'mismatch' || !interpreted.paymentIntentId) {
    return;
  }
  const action = interpreted.action;
  const paymentIntentId = interpreted.paymentIntentId;
  const located = await findMeterPaymentByPaymentIntent(paymentIntentId);
  if (!located || located.subjectType !== 'on_demand' || !located.bookingId) return;
  if (located.settlementMode !== MeterSettlementMode.STRIPE_TEST) return;
  const { commitOnDemandPaymentIntentSettlement } = await import('./onDemandMeterPayment.service');
  const { runOnDemandFarePaymentLock } = await import('./onDemandMeterPayment');
  await runOnDemandFarePaymentLock(located.fareRecordId, async () => {
    const payment = await findMeterPaymentById(located.id);
    if (!payment) return;
    await commitOnDemandPaymentIntentSettlement(payment.id, {
      action,
      amount: interpreted.amount,
      currency: interpreted.currency,
      paymentIntentId,
      receiptUrl: interpreted.receiptUrl,
    });
  });
}

export async function handleMeterCheckoutWebhook(event: Stripe.Event): Promise<void> {
  if (event.type.startsWith('payment_intent.')) {
    await handleOnDemandPaymentIntentWebhook(event);
    return;
  }
  if (event.type === 'charge.refunded') {
    await handleTestRefund(event);
    return;
  }
  if (!event.type.startsWith('checkout.session.')) return;
  if (event.livemode === true) {
    logger.info({ type: 'meter.checkout.live_mode_rejected', stripeEventId: event.id });
    return;
  }
  const interpreted = interpretCheckoutEvent(event);
  if (interpreted.action === 'ignore' || !interpreted.checkoutSessionId) {
    logger.info({
      type: 'meter.checkout.ignored',
      stripeEventId: event.id,
      reason: interpreted.reason,
    });
    return;
  }
  const payment = await findMeterPaymentByCheckout(interpreted.checkoutSessionId);
  if (!payment) {
    logger.info({
      type: 'meter.checkout.unknown',
      stripeEventId: event.id,
      checkoutSessionId: interpreted.checkoutSessionId,
    });
    return;
  }
  const testPayment =
    payment.settlementMode === MeterSettlementMode.STRIPE_TEST || payment.testOnly === true;
  if (testPayment && interpreted.action === 'paid') {
    const verdict = verifyTestCheckoutWebhook({
      livemode: event.livemode,
      action: 'paid',
      amountTotal: interpreted.amountTotal,
      currency: interpreted.currency,
      expectedAmountCents: payment.amountCents,
      expectedCurrency: payment.currency,
      currentStatus: payment.status as MeterPaymentStatusType,
      testPayment: true,
    });
    if (!verdict.acceptPaid) {
      if (verdict.changed && verdict.status !== payment.status) {
        const updated = await updateMeterPayment(payment.id, {
          status: verdict.status,
          failureCode: verdict.failureCode,
        });
        if (payment.walkUpTripId && updated) {
          await publishWalkUpPayment(
            payment.walkUpTripId,
            updated.status,
            updated.hostedUrl,
            updated.receiptUrl,
            true
          );
        }
        if (payment.bookingId && updated) {
          const { publishOnDemandMeterPayment } = await import('./onDemandMeterPayment.service');
          await publishOnDemandMeterPayment(updated);
        }
      }
      return;
    }
  }
  const signal =
    interpreted.action === 'paid'
      ? ({ type: 'webhook_paid' } as const)
      : interpreted.action === 'failed'
        ? ({ type: 'webhook_failed' } as const)
        : ({ type: 'webhook_expired' } as const);
  const next = applyPaymentSignal(payment.status as MeterPaymentStatusType, signal);
  if (!next.changed) return;
  const updated = await updateMeterPayment(payment.id, {
    status: next.status,
    stripePaymentIntentId: interpreted.paymentIntentId ?? payment.stripePaymentIntentId,
    receiptUrl: next.markPaid ? interpreted.receiptUrl ?? payment.receiptUrl : payment.receiptUrl,
    paidAt: next.markPaid ? new Date() : payment.paidAt,
    failureCode: interpreted.action === 'failed' ? interpreted.reason : payment.failureCode,
  });
  if (payment.walkUpTripId && updated) {
    await publishWalkUpPayment(
      payment.walkUpTripId,
      updated.status,
      updated.hostedUrl,
      updated.receiptUrl,
      payment.testOnly === true || payment.settlementMode === MeterSettlementMode.STRIPE_TEST
    );
  }
  if (payment.bookingId && updated) {
    const { publishOnDemandMeterPayment } = await import('./onDemandMeterPayment.service');
    await publishOnDemandMeterPayment(updated);
  }
}
