import {
  METER_CHECKOUT_PURPOSE,
  MeterPaymentStatus,
  MeterSettlementMode,
  TEST_ONLY_UNAPPROVED_TARIFF,
  type MeterPaymentStatusType,
} from '../../constants/softMeter';
import { classifyStripePublishableMode, classifyStripeSecretMode } from '../../config/stripe';
import { MeterError, isUniqueViolation } from './errors';
import { KeyedMutex } from './lifecycle';
import {
  applyPaymentSignal,
  assessStoredOnDemandPaymentIntent,
  meterPaymentIntentWebhookDecision,
  type StoredPaymentIntentSnapshot,
} from './paymentState';
import {
  assertWalkUpTestFare,
  WALKUP_TEST_CHECKOUT_TTL_MS,
  type StoredTestPayment,
  type TestFareInput,
  type TestPaymentStore,
  type WalkUpStripeTestConfig,
} from './testPayment';

export const ON_DEMAND_METER_CHECKOUT_TTL_MS = WALKUP_TEST_CHECKOUT_TTL_MS;

export const ON_DEMAND_METER_PAYMENT_LIMITATIONS = [
  'This amount is a Stripe test-mode fare, not a production charge.',
  'The passenger pays the finalized server meter total. The original booking quote is not captured.',
  'Flag drop, completed distance increments, and eligible stopped time are included.',
  'Paused time is excluded. Partial stopped minutes and partial distance increments are not billed.',
  'The below-10-mph switch is not used. Slow travel bills distance only.',
  'This tariff is not regulator-approved.',
] as const;

const checkoutMutex = new KeyedMutex();
const paymentIntentMutex = new KeyedMutex();

export function runOnDemandFarePaymentLock<T>(fareId: string, fn: () => Promise<T>): Promise<T> {
  return paymentIntentMutex.run(fareId, fn);
}

export const PAYMENT_INTENT_RECONCILE_MIN_INTERVAL_MS = 15_000;

export interface PaymentIntentReconcileState {
  lastAttemptMs: number | null;
}

const REUSABLE_PAYMENT_INTENT_STATUSES = new Set([
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
  'processing',
]);

export interface LegacyCheckoutSnapshot {
  status: string;
  paymentStatus: string | null;
  livemode: boolean;
  amountTotal: number | null;
  currency: string | null;
  purpose: string | null;
  bookingId: string | null;
  paymentIntent: {
    id: string;
    status: string;
    livemode: boolean;
    amount: number;
    currency: string;
    receiptUrl: string | null;
  } | null;
}

export type LegacyCheckoutAssessment =
  | 'paid'
  | 'processing'
  | 'retire'
  | 'blocked_live'
  | 'blocked_identity'
  | 'blocked_amount';

/** Decide what a stored hosted Checkout session means before any new charge. */
export function assessLegacyCheckout(input: {
  expectedBookingId: string;
  expectedAmountCents: number;
  snapshot: LegacyCheckoutSnapshot;
}): LegacyCheckoutAssessment {
  const snap = input.snapshot;
  if (snap.livemode || snap.paymentIntent?.livemode) return 'blocked_live';
  if (snap.bookingId !== input.expectedBookingId || snap.purpose !== METER_CHECKOUT_PURPOSE.ON_DEMAND_TEST) {
    return 'blocked_identity';
  }
  const currency = (snap.currency ?? '').toLowerCase();
  if (snap.amountTotal !== input.expectedAmountCents || currency !== 'usd') return 'blocked_amount';
  if (
    snap.paymentIntent &&
    (snap.paymentIntent.amount !== input.expectedAmountCents ||
      snap.paymentIntent.currency.toLowerCase() !== 'usd')
  ) {
    return 'blocked_amount';
  }
  const intentSucceeded = snap.paymentIntent?.status === 'succeeded';
  if (snap.paymentStatus === 'paid' && (snap.paymentIntent == null || intentSucceeded)) return 'paid';
  if (intentSucceeded && snap.paymentStatus !== 'paid') return 'processing';
  if (snap.paymentIntent?.status === 'processing') return 'processing';
  return 'retire';
}

export type QuoteSettlementAction =
  | 'capture_quote'
  | 'release_quote_and_meter_test'
  | 'leave_historical_quote';

/**
 * Metered rides settle on the finalized meter fare.
 * A quote that was already captured stays as a historical record and is not charged again.
 * Rides without a meter keep the existing quote settlement.
 */
export function onDemandCompletionSettlement(input: {
  hasMeterSession: boolean;
  meterVoided: boolean;
  quoteAlreadyCaptured: boolean;
}): QuoteSettlementAction {
  if (!input.hasMeterSession || input.meterVoided) return 'capture_quote';
  if (input.quoteAlreadyCaptured) return 'leave_historical_quote';
  return 'release_quote_and_meter_test';
}

export function publicOnDemandPaymentStatus(status: string): string {
  if (status === MeterPaymentStatus.PENDING) return 'payment_pending';
  if (status === MeterPaymentStatus.CHECKOUT_OPEN) return 'checkout_open';
  if (status === MeterPaymentStatus.FAILED || status === MeterPaymentStatus.CANCELLED) {
    return 'payment_failed';
  }
  if (status === MeterPaymentStatus.PAID) return 'paid';
  if (status === MeterPaymentStatus.REFUNDED) return 'refunded';
  return 'payment_pending';
}

export function meterPaymentRequired(status: string): boolean {
  return (
    status === MeterPaymentStatus.PENDING ||
    status === MeterPaymentStatus.CHECKOUT_OPEN ||
    status === MeterPaymentStatus.FAILED ||
    status === MeterPaymentStatus.CANCELLED
  );
}

export function pickLatestUnpaidMeterPayment<T extends { completedAtMs: number; status: string }>(
  rows: T[]
): T | null {
  const unpaid = rows
    .filter((row) => meterPaymentRequired(row.status))
    .sort((left, right) => right.completedAtMs - left.completedAtMs);
  return unpaid[0] ?? null;
}

export interface OnDemandMeterPaymentView {
  bookingId: string;
  rideStatus: string;
  paymentStatus: string;
  paymentRequired: boolean;
  paymentMode: 'stripe_test' | null;
  finalFareCents: number | null;
  currency: string | null;
  meterSessionId: string | null;
  completedAt: string | null;
  paidAt: string | null;
  receiptAvailable: boolean;
  receiptUrl: string | null;
  hostedUrl: string | null;
  testMode: boolean;
  fareClassification: string | null;
  paymentVersion: number;
  productionCharge: false;
  limitations: readonly string[];
}

export function toOnDemandMeterPaymentView(input: {
  bookingId: string;
  rideStatus: string;
  completedAt: string | null;
  meterSessionId: string | null;
  payment: StoredTestPayment | null;
}): OnDemandMeterPaymentView {
  const payment = input.payment;
  const status = payment?.status ?? MeterPaymentStatus.PENDING;
  const open =
    payment?.status === MeterPaymentStatus.CHECKOUT_OPEN &&
    Boolean(payment.hostedUrl) &&
    (payment.expiresAtMs == null || payment.expiresAtMs > Date.now());
  return {
    bookingId: input.bookingId,
    rideStatus: input.rideStatus,
    paymentStatus: payment ? publicOnDemandPaymentStatus(status) : 'payment_pending',
    paymentRequired: payment ? meterPaymentRequired(status) : false,
    paymentMode: payment?.settlementMode === MeterSettlementMode.STRIPE_TEST ? 'stripe_test' : null,
    finalFareCents: payment?.amountCents ?? null,
    currency: payment?.currency ?? null,
    meterSessionId: input.meterSessionId,
    completedAt: input.completedAt,
    paidAt: payment?.paidAtMs == null ? null : new Date(payment.paidAtMs).toISOString(),
    receiptAvailable: payment?.status === MeterPaymentStatus.PAID && Boolean(payment.receiptUrl),
    receiptUrl: payment?.status === MeterPaymentStatus.PAID ? payment.receiptUrl : null,
    hostedUrl: open ? payment?.hostedUrl ?? null : null,
    testMode: payment?.testOnly === true,
    fareClassification: payment?.fareClassification ?? null,
    paymentVersion: payment?.updatedAtMs ?? payment?.createdAtMs ?? 0,
    productionCharge: false,
    limitations: payment ? ON_DEMAND_METER_PAYMENT_LIMITATIONS : [],
  };
}

export function readOnDemandStripeTestConfig(
  env: NodeJS.ProcessEnv = process.env
): WalkUpStripeTestConfig {
  const paymentsFlag = env.ONDEMAND_STRIPE_TEST_PAYMENTS?.trim();
  const sandboxFlag = env.ONDEMAND_STRIPE_TEST_SANDBOX?.trim();
  return {
    paymentsFlag: paymentsFlag || undefined,
    sandboxFlag: sandboxFlag || undefined,
    nodeEnv: env.NODE_ENV,
    secretMode: env.STRIPE_SECRET_KEY?.trim()
      ? classifyStripeSecretMode(env.STRIPE_SECRET_KEY.trim())
      : 'not_configured',
    publishableMode: env.STRIPE_PUBLISHABLE_KEY?.trim()
      ? classifyStripePublishableMode(env.STRIPE_PUBLISHABLE_KEY.trim())
      : 'not_configured',
    webhookConfigured: Boolean(env.STRIPE_WEBHOOK_SECRET?.trim()),
    successUrl: env.METER_CHECKOUT_SUCCESS_URL?.trim() || undefined,
    cancelUrl: env.METER_CHECKOUT_CANCEL_URL?.trim() || undefined,
  };
}

export function evaluateOnDemandStripeTestConfig(
  config: WalkUpStripeTestConfig
):
  | { action: 'disabled' }
  | { action: 'reject'; code: string; message: string; status: number }
  | { action: 'ready' } {
  if (config.paymentsFlag !== 'true') return { action: 'disabled' };
  if (config.secretMode === 'live') {
    return {
      action: 'reject',
      code: 'STRIPE_LIVE_CREDENTIALS_REJECTED',
      message: 'On-demand meter test Checkout refuses live Stripe credentials.',
      status: 503,
    };
  }
  if (config.secretMode !== 'test') {
    return {
      action: 'reject',
      code: 'ONDEMAND_STRIPE_TEST_NOT_CONFIGURED',
      message: 'On-demand meter test Checkout requires an sk_test Stripe secret.',
      status: 503,
    };
  }
  if (config.publishableMode !== 'not_configured' && config.publishableMode !== 'test') {
    return {
      action: 'reject',
      code: 'ONDEMAND_STRIPE_TEST_NOT_CONFIGURED',
      message: 'The Stripe publishable key must be a pk_test key when it is set.',
      status: 503,
    };
  }
  if (config.nodeEnv === 'production' && config.sandboxFlag !== 'authorized') {
    return {
      action: 'reject',
      code: 'ONDEMAND_TEST_SANDBOX_NOT_AUTHORIZED',
      message:
        'Production refuses on-demand meter test Checkout unless this process is an isolated sandbox (ONDEMAND_STRIPE_TEST_SANDBOX=authorized) using test keys.',
      status: 409,
    };
  }
  if (!config.webhookConfigured || !config.successUrl || !config.cancelUrl) {
    return {
      action: 'reject',
      code: 'ONDEMAND_STRIPE_TEST_NOT_CONFIGURED',
      message:
        'On-demand meter test Checkout requires STRIPE_WEBHOOK_SECRET, METER_CHECKOUT_SUCCESS_URL, and METER_CHECKOUT_CANCEL_URL.',
      status: 503,
    };
  }
  return { action: 'ready' };
}

/**
 * In-app PaymentSheet does not use Checkout success or cancel URLs.
 * Live keys and production charging stay rejected.
 */
export function evaluateOnDemandPaymentIntentConfig(
  config: WalkUpStripeTestConfig
):
  | { action: 'disabled' }
  | { action: 'reject'; code: string; message: string; status: number }
  | { action: 'ready' } {
  if (config.paymentsFlag !== 'true') return { action: 'disabled' };
  if (config.secretMode === 'live' || config.publishableMode === 'live') {
    return {
      action: 'reject',
      code: 'STRIPE_LIVE_CREDENTIALS_REJECTED',
      message: 'On-demand meter PaymentIntent refuses live Stripe credentials.',
      status: 503,
    };
  }
  if (config.secretMode !== 'test' || config.publishableMode !== 'test') {
    return {
      action: 'reject',
      code: 'ONDEMAND_STRIPE_TEST_NOT_CONFIGURED',
      message: 'On-demand meter PaymentIntent requires sk_test and pk_test Stripe keys.',
      status: 503,
    };
  }
  if (config.nodeEnv === 'production' && config.sandboxFlag !== 'authorized') {
    return {
      action: 'reject',
      code: 'ONDEMAND_TEST_SANDBOX_NOT_AUTHORIZED',
      message:
        'Production refuses on-demand meter test PaymentIntents unless this process is an isolated sandbox (ONDEMAND_STRIPE_TEST_SANDBOX=authorized) using test keys.',
      status: 409,
    };
  }
  if (!config.webhookConfigured) {
    return {
      action: 'reject',
      code: 'ONDEMAND_STRIPE_TEST_NOT_CONFIGURED',
      message: 'On-demand meter PaymentIntent requires STRIPE_WEBHOOK_SECRET.',
      status: 503,
    };
  }
  return { action: 'ready' };
}

function checkoutStillOpen(payment: StoredTestPayment, nowMs: number): boolean {
  return (
    payment.status === MeterPaymentStatus.CHECKOUT_OPEN &&
    Boolean(payment.hostedUrl) &&
    payment.expiresAtMs != null &&
    payment.expiresAtMs > nowMs
  );
}

export async function openOnDemandTestCheckout(input: {
  actorCustomerId: string;
  booking: { id: string; customerId: string; status: string };
  session: { id: string; status: string };
  fare: TestFareInput;
  existing: StoredTestPayment | null;
  config: WalkUpStripeTestConfig;
  nowMs: number;
  store: TestPaymentStore;
  createCheckout: (request: {
    amountCents: number;
    currency: string;
    idempotencyKey: string;
    metadata: Record<string, string>;
    subjectId: string;
    expiresAtUnix: number;
    productName: string;
  }) => Promise<{ id: string; url: string }>;
  expireCheckout: (checkoutSessionId: string) => Promise<'expired' | 'paid'>;
}): Promise<StoredTestPayment> {
  if (input.booking.customerId !== input.actorCustomerId) {
    throw new MeterError('BOOKING_NOT_FOUND', 'Booking not found.', 404);
  }
  if (input.booking.status !== 'completed') {
    throw new MeterError(
      'RIDE_NOT_COMPLETED',
      'Meter payment opens after the driver completes the ride.',
      409
    );
  }
  if (input.session.status !== 'finalized') {
    throw new MeterError('METER_NOT_FINALIZED', 'Finalize the meter before requesting payment.', 409);
  }
  assertWalkUpTestFare(input.fare);
  const gate = evaluateOnDemandStripeTestConfig(input.config);
  if (gate.action === 'disabled') {
    throw new MeterError(
      'METER_CHARGING_DISABLED',
      'On-demand meter test Checkout is disabled. Production metered charging remains off.',
      409
    );
  }
  if (gate.action === 'reject') {
    throw new MeterError(gate.code, gate.message, gate.status);
  }
  if (!input.existing) {
    throw new MeterError(
      'METER_PAYMENT_MISSING',
      'The completed ride has no pending meter payment.',
      409
    );
  }
  if (input.existing.amountCents !== input.fare.totalCents || input.existing.currency.toUpperCase() !== 'USD') {
    throw new MeterError(
      'FARE_EVIDENCE_MISMATCH',
      'The stored meter payment amount does not match the finalized fare.',
      409
    );
  }

  return checkoutMutex.run(input.fare.id, async () => {
    const existing = (await input.store.findByFare(input.fare.id)) ?? input.existing;
    if (!existing) {
      throw new MeterError('METER_PAYMENT_MISSING', 'The completed ride has no pending meter payment.', 409);
    }
    if (existing.amountCents !== input.fare.totalCents) {
      throw new MeterError(
        'FARE_EVIDENCE_MISMATCH',
        'The stored meter payment amount does not match the finalized fare.',
        409
      );
    }
    if (existing.status === MeterPaymentStatus.PAID || existing.status === MeterPaymentStatus.REFUNDED) {
      return existing;
    }
    if (checkoutStillOpen(existing, input.nowMs)) return existing;
    if (existing.status === MeterPaymentStatus.CHECKOUT_OPEN && existing.stripeCheckoutSessionId) {
      const expired = await input.expireCheckout(existing.stripeCheckoutSessionId);
      if (expired === 'paid') {
        return input.store.update(existing.id, {
          status: MeterPaymentStatus.PAID,
          paidAtMs: input.nowMs,
          hostedUrl: null,
          updatedAtMs: input.nowMs,
        });
      }
    }

    const expiresAtMs = input.nowMs + ON_DEMAND_METER_CHECKOUT_TTL_MS;
    const checkout = await input.createCheckout({
      amountCents: existing.amountCents,
      currency: 'usd',
      idempotencyKey: existing.stripeCheckoutSessionId
        ? `ondemand_meter_test:${input.fare.id}:${existing.stripeCheckoutSessionId}`
        : `ondemand_meter_test:${input.fare.id}`,
      metadata: {
        purpose: METER_CHECKOUT_PURPOSE.ON_DEMAND_TEST,
        bookingId: input.booking.id,
        meterSessionId: input.session.id,
        fareRecordId: input.fare.id,
        settlementMode: MeterSettlementMode.STRIPE_TEST,
        testOnly: 'true',
        fareClassification: TEST_ONLY_UNAPPROVED_TARIFF,
      },
      subjectId: input.booking.id,
      expiresAtUnix: Math.floor(expiresAtMs / 1000),
      productName: 'DriveWize on-demand meter fare (test mode)',
    });
    try {
      return await input.store.update(existing.id, {
        status: MeterPaymentStatus.CHECKOUT_OPEN,
        hostedUrl: checkout.url,
        stripeCheckoutSessionId: checkout.id,
        amountCents: existing.amountCents,
        currency: 'USD',
        settlementMode: MeterSettlementMode.STRIPE_TEST,
        testOnly: true,
        fareClassification: TEST_ONLY_UNAPPROVED_TARIFF,
        expiresAtMs,
        failureCode: null,
        updatedAtMs: input.nowMs,
      });
    } catch (error) {
      if (!isUniqueViolation(error)) {
        if (error instanceof MeterError) throw error;
        throw new MeterError('METER_CHECKOUT_FAILED', 'Stripe test Checkout could not be created.', 502);
      }
      const raced = await input.store.findByFare(input.fare.id);
      if (!raced) throw error;
      return raced;
    }
  });
}

export function browserReturnLeavesPaymentUnchanged(status: MeterPaymentStatusType): MeterPaymentStatusType {
  return applyPaymentSignal(status, { type: 'customer_returned' }).status;
}

export interface OnDemandPaymentIntentResult {
  payment: StoredTestPayment;
  paymentIntentId: string | null;
  paymentIntentClientSecret: string | null;
  publishableKey: string | null;
  finalFareCents: number;
  currency: string;
  paymentStatus: string;
  testMode: true;
  paymentVersion: number;
}

export interface PaymentIntentReconcileCommit {
  action: 'paid' | 'failed' | 'canceled';
  amount: number | null;
  currency: string | null;
  paymentIntentId: string;
  receiptUrl: string | null;
}

/**
 * Reads the stored PaymentIntent only. Does not create or capture a payment.
 * Paid and refunded rows skip Stripe. Unpaid rows are throttled between reads.
 * Checkout-open rows stay on the legacy Checkout path.
 */
export async function reconcileStoredOnDemandPaymentIntent(input: {
  payment: StoredTestPayment;
  bookingId: string;
  expectedFareCents: number;
  nowMs: number;
  state: PaymentIntentReconcileState;
  retrievePaymentIntent: (paymentIntentId: string) => Promise<StoredPaymentIntentSnapshot>;
  commit: (verdict: PaymentIntentReconcileCommit) => Promise<StoredTestPayment>;
}): Promise<StoredTestPayment> {
  const payment = input.payment;
  if (!payment.stripePaymentIntentId) return payment;
  if (
    payment.status === MeterPaymentStatus.PAID ||
    payment.status === MeterPaymentStatus.REFUNDED ||
    payment.status === MeterPaymentStatus.CHECKOUT_OPEN ||
    payment.status === MeterPaymentStatus.NOT_BILLABLE
  ) {
    return payment;
  }
  if (payment.amountCents !== input.expectedFareCents) return payment;
  const last = input.state.lastAttemptMs;
  if (last != null && input.nowMs - last < PAYMENT_INTENT_RECONCILE_MIN_INTERVAL_MS) {
    return payment;
  }
  input.state.lastAttemptMs = input.nowMs;
  const snapshot = await input.retrievePaymentIntent(payment.stripePaymentIntentId);
  const assessment = assessStoredOnDemandPaymentIntent({
    expectedBookingId: input.bookingId,
    expectedPaymentId: payment.id,
    expectedFareRecordId: payment.fareRecordId,
    expectedAmountCents: payment.amountCents,
    expectedCurrency: payment.currency,
    storedPaymentIntentId: payment.stripePaymentIntentId,
    snapshot,
  });
  if (assessment === 'pending' || assessment === 'blocked_live' || assessment === 'blocked_identity' || assessment === 'blocked_amount') {
    return payment;
  }
  const decision = meterPaymentIntentWebhookDecision({
    action: assessment,
    amount: snapshot.amount,
    currency: snapshot.currency,
    expectedAmountCents: payment.amountCents,
    expectedCurrency: payment.currency,
    currentStatus: payment.status,
  });
  if (!decision.accept && decision.status === payment.status) return payment;
  return input.commit({
    action: assessment,
    amount: snapshot.amount,
    currency: snapshot.currency,
    paymentIntentId: snapshot.id,
    receiptUrl: snapshot.receiptUrl,
  });
}

/**
 * Creates or reuses one Stripe test PaymentIntent for the stored meter fare.
 * Returning this secret does not mark the ride paid.
 */
export async function openOnDemandTestPaymentIntent(input: {
  actorCustomerId: string;
  booking: { id: string; customerId: string; status: string };
  session: { id: string; status: string };
  fare: TestFareInput;
  existing: StoredTestPayment | null;
  config: WalkUpStripeTestConfig;
  publishableKey: string | null;
  store: TestPaymentStore;
  retrieveCheckout?: (checkoutSessionId: string) => Promise<LegacyCheckoutSnapshot>;
  expireCheckout?: (checkoutSessionId: string) => Promise<LegacyCheckoutSnapshot>;
  retrievePaymentIntent: (paymentIntentId: string) => Promise<{
    id: string;
    clientSecret: string | null;
    amount: number;
    currency: string;
    status: string;
    livemode: boolean;
    receiptUrl?: string | null;
    purpose?: string | null;
    bookingId?: string | null;
    meterPaymentId?: string | null;
    fareRecordId?: string | null;
  }>;
  createPaymentIntent: (request: {
    amountCents: number;
    currency: string;
    idempotencyKey: string;
    metadata: Record<string, string>;
  }) => Promise<{
    id: string;
    clientSecret: string | null;
    amount: number;
    currency: string;
    status: string;
    livemode: boolean;
  }>;
}): Promise<OnDemandPaymentIntentResult> {
  if (input.booking.customerId !== input.actorCustomerId) {
    throw new MeterError('BOOKING_NOT_FOUND', 'Booking not found.', 404);
  }
  if (input.booking.status !== 'completed') {
    throw new MeterError(
      'RIDE_NOT_COMPLETED',
      'Meter payment opens after the driver completes the ride.',
      409
    );
  }
  if (input.session.status !== 'finalized') {
    throw new MeterError('METER_NOT_FINALIZED', 'Finalize the meter before requesting payment.', 409);
  }
  assertWalkUpTestFare(input.fare);
  const gate = evaluateOnDemandPaymentIntentConfig(input.config);
  if (gate.action === 'disabled') {
    throw new MeterError(
      'METER_CHARGING_DISABLED',
      'On-demand meter test payments are disabled. Production metered charging remains off.',
      409
    );
  }
  if (gate.action === 'reject') {
    throw new MeterError(gate.code, gate.message, gate.status);
  }
  if (!input.existing) {
    throw new MeterError(
      'METER_PAYMENT_MISSING',
      'The completed ride has no pending meter payment.',
      409
    );
  }
  if (
    input.existing.amountCents !== input.fare.totalCents ||
    input.existing.currency.toUpperCase() !== 'USD'
  ) {
    throw new MeterError(
      'FARE_EVIDENCE_MISMATCH',
      'The stored meter payment amount does not match the finalized fare.',
      409
    );
  }
  return paymentIntentMutex.run(input.fare.id, async () => {
    const existing = (await input.store.findByFare(input.fare.id)) ?? input.existing;
    if (!existing) {
      throw new MeterError('METER_PAYMENT_MISSING', 'The completed ride has no pending meter payment.', 409);
    }
    if (existing.amountCents !== input.fare.totalCents) {
      throw new MeterError(
        'FARE_EVIDENCE_MISMATCH',
        'The stored meter payment amount does not match the finalized fare.',
        409
      );
    }
    if (
      existing.status === MeterPaymentStatus.PAID ||
      existing.status === MeterPaymentStatus.REFUNDED
    ) {
      return sheetResult(existing, null, null, input.publishableKey);
    }

    let current = existing;
    if (current.status === MeterPaymentStatus.CHECKOUT_OPEN && current.stripeCheckoutSessionId) {
      if (!input.retrieveCheckout) {
        throw new MeterError(
          'ONDEMAND_CHECKOUT_RETIRED',
          'This ride already has a hosted Checkout session. A second in-app charge was not created.',
          409
        );
      }
      const checkoutSessionId = current.stripeCheckoutSessionId;
      let snapshot = await input.retrieveCheckout(checkoutSessionId);
      let assessment = assessLegacyCheckout({
        expectedBookingId: input.booking.id,
        expectedAmountCents: current.amountCents,
        snapshot,
      });
      if (assessment === 'retire' && snapshot.status === 'open') {
        if (!input.expireCheckout) {
          throw new MeterError(
            'ONDEMAND_CHECKOUT_RETIRED',
            'This ride already has a hosted Checkout session. A second in-app charge was not created.',
            409
          );
        }
        snapshot = await input.expireCheckout(checkoutSessionId);
        assessment = assessLegacyCheckout({
          expectedBookingId: input.booking.id,
          expectedAmountCents: current.amountCents,
          snapshot,
        });
      }
      if (assessment === 'blocked_live') {
        throw new MeterError(
          'STRIPE_LIVE_MODE_REJECTED',
          'A live-mode Checkout session cannot be reconciled for a test meter fare.',
          409
        );
      }
      if (assessment === 'blocked_identity') {
        throw new MeterError(
          'PAYMENT_IDENTITY_MISMATCH',
          'The Stripe Checkout session does not belong to this booking.',
          409
        );
      }
      if (assessment === 'blocked_amount') {
        throw new MeterError(
          'FARE_EVIDENCE_MISMATCH',
          'The Stripe Checkout amount does not match the finalized meter fare.',
          409
        );
      }
      if (assessment === 'processing') {
        throw new MeterError(
          'PAYMENT_PROCESSING',
          'The previous Checkout payment is still processing. A second charge was not created.',
          409
        );
      }
      if (assessment === 'paid') {
        const next = applyPaymentSignal(current.status, { type: 'webhook_paid' });
        const saved = await input.store.update(current.id, {
          status: next.status,
          stripePaymentIntentId: snapshot.paymentIntent?.id ?? current.stripePaymentIntentId,
          receiptUrl: snapshot.paymentIntent?.receiptUrl ?? current.receiptUrl,
          paidAtMs: next.markPaid ? Date.now() : current.paidAtMs,
          hostedUrl: null,
        });
        return sheetResult(saved, snapshot.paymentIntent?.id ?? null, null, input.publishableKey);
      }
      current = await input.store.update(current.id, {
        status: MeterPaymentStatus.PENDING,
        hostedUrl: null,
      });
    }

    let intent: {
      id: string;
      clientSecret: string | null;
      amount: number;
      currency: string;
      status: string;
      livemode: boolean;
      receiptUrl?: string | null;
      purpose?: string | null;
      bookingId?: string | null;
      meterPaymentId?: string | null;
      fareRecordId?: string | null;
    } | null = null;
    if (current.stripePaymentIntentId) {
      intent = await input.retrievePaymentIntent(current.stripePaymentIntentId);
      assertIntentMatchesFare(intent, existing.amountCents);
      if (intent.status === 'succeeded') {
        const assessment = assessStoredOnDemandPaymentIntent({
          expectedBookingId: input.booking.id,
          expectedPaymentId: current.id,
          expectedFareRecordId: current.fareRecordId,
          expectedAmountCents: current.amountCents,
          expectedCurrency: current.currency,
          storedPaymentIntentId: current.stripePaymentIntentId,
          snapshot: {
            id: intent.id,
            status: intent.status,
            livemode: intent.livemode,
            amount: intent.amount,
            currency: intent.currency,
            receiptUrl: intent.receiptUrl ?? null,
            purpose: intent.purpose ?? null,
            bookingId: intent.bookingId ?? null,
            meterPaymentId: intent.meterPaymentId ?? null,
            fareRecordId: intent.fareRecordId ?? null,
            lastPaymentError: false,
          },
        });
        if (assessment === 'paid') {
          const next = applyPaymentSignal(current.status, { type: 'webhook_paid' });
          const saved = next.changed
            ? await input.store.update(current.id, {
                status: next.status,
                stripePaymentIntentId: intent.id,
                receiptUrl: intent.receiptUrl ?? current.receiptUrl,
                paidAtMs: Date.now(),
                hostedUrl: null,
              })
            : current;
          return sheetResult(saved, intent.id, null, input.publishableKey);
        }
        return sheetResult(current, intent.id, null, input.publishableKey);
      }
      if (!REUSABLE_PAYMENT_INTENT_STATUSES.has(intent.status)) {
        intent = null;
      }
    }
    if (!intent) {
      intent = await input.createPaymentIntent({
        amountCents: existing.amountCents,
        currency: 'usd',
        idempotencyKey: current.stripePaymentIntentId
          ? `ondemand_meter_pi:${input.fare.id}:${current.stripePaymentIntentId}`
          : `ondemand_meter_pi:${input.fare.id}`,
        metadata: {
          purpose: METER_CHECKOUT_PURPOSE.ON_DEMAND_TEST,
          meterPaymentId: existing.id,
          bookingId: input.booking.id,
          meterSessionId: input.session.id,
          fareRecordId: input.fare.id,
          settlementMode: MeterSettlementMode.STRIPE_TEST,
          testOnly: 'true',
          fareClassification: TEST_ONLY_UNAPPROVED_TARIFF,
        },
      });
      assertIntentMatchesFare(intent, existing.amountCents);
    }

    const retry = applyPaymentSignal(current.status, { type: 'retry_requested' });
    const saved = await input.store.update(current.id, {
      stripePaymentIntentId: intent.id,
      status: retry.changed ? retry.status : current.status,
      hostedUrl: null,
    });
    return sheetResult(saved, intent.id, intent.clientSecret, input.publishableKey);
  });
}

function assertIntentMatchesFare(
  intent: { amount: number; currency: string; livemode: boolean },
  amountCents: number
): void {
  if (intent.livemode) {
    throw new MeterError(
      'STRIPE_LIVE_MODE_REJECTED',
      'A live-mode PaymentIntent cannot pay a test meter fare.',
      409
    );
  }
  if (intent.amount !== amountCents || intent.currency.toLowerCase() !== 'usd') {
    throw new MeterError(
      'FARE_EVIDENCE_MISMATCH',
      'The Stripe PaymentIntent amount does not match the finalized meter fare.',
      409
    );
  }
}

function sheetResult(
  payment: StoredTestPayment,
  paymentIntentId: string | null,
  paymentIntentClientSecret: string | null,
  publishableKey: string | null
): OnDemandPaymentIntentResult {
  return {
    payment,
    paymentIntentId,
    paymentIntentClientSecret,
    publishableKey,
    finalFareCents: payment.amountCents,
    currency: payment.currency.toUpperCase(),
    paymentStatus: publicOnDemandPaymentStatus(payment.status),
    testMode: true,
    paymentVersion: payment.updatedAtMs ?? payment.createdAtMs ?? 0,
  };
}
